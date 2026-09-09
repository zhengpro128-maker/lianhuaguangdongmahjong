import { createRemoteSessionStore } from '../game/online/session/remoteSessionStore'
import type { MatchType } from '../game/core/contracts/types'
import type { RuleVariant } from '../game/core/rules/ruleVariants'
import { createWechatHttpClient, WechatRemoteApiError, type WechatRequestOptions } from './http'
import { buildRoomInviteQuery, listenForRoomInvites, type RoomInvite } from './invite'
import { createWechatSocketFactory } from './socket'
import { createWechatStorage } from './storage'
import { errorMessage, type WxGameApi } from './wx'

const AUTH_SESSION_KEY = 'lgm_wechat_auth_session'
const LEGACY_ACCESS_TOKEN_KEY = 'lgm_wechat_access_token'
const EXPIRY_SKEW_SECONDS = 60

export interface WechatAccount {
  playerId: string
  accessToken: string
  expiresAt: number
}

export interface WechatRoomInviteResponse {
  roomId: string
  inviteTicket: string
  expiresAt?: string
}

export interface WechatJoinInviteResponse {
  roomId: string
  seat: number
  nickname: string
  playerId: string
  rejoinCode: string
  mode: MatchType
  rulesetId?: RuleVariant
}

export function createWechatGameRuntime(options: {
  wx: WxGameApi
  apiBase: string
  shareImageUrl?: string
  now?: () => number
}) {
  const storage = createWechatStorage(options.wx)
  const now = options.now ?? (() => Date.now())
  let authSession = loadAuthSession()
  let loginPromise: Promise<WechatAccount> | null = null
  let pendingInvite: RoomInvite | null = null
  const inviteListeners = new Set<(invite: RoomInvite) => void>()

  const http = createWechatHttpClient({
    wx: options.wx,
    baseUrl: options.apiBase,
    getAccessToken: () => authSession?.accessToken ?? null,
  })
  const sessionStore = createRemoteSessionStore(() => storage)
  const socketFactory = createWechatSocketFactory(options.wx, () => authSession?.accessToken ?? null)

  function loadAuthSession(): WechatAccount | null {
    const raw = storage.getItem(AUTH_SESSION_KEY)
    storage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as Partial<WechatAccount>
      if (!value.playerId || !value.accessToken || !Number.isFinite(value.expiresAt)) return null
      if ((value.expiresAt as number) <= now() / 1000 + EXPIRY_SKEW_SECONDS) return null
      return value as WechatAccount
    } catch {
      return null
    }
  }

  function saveAuthSession(account: WechatAccount) {
    authSession = account
    storage.setItem(AUTH_SESSION_KEY, JSON.stringify(account))
    sessionStore.saveGuestId(account.playerId)
  }

  function clearAuthSession(clearRoomSession: boolean) {
    authSession = null
    storage.removeItem(AUTH_SESSION_KEY)
    storage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
    if (clearRoomSession) sessionStore.clearSession()
  }

  function receiveInvite(invite: RoomInvite) {
    pendingInvite = invite
    inviteListeners.forEach((listener) => listener(invite))
  }

  const stopInviteListener = listenForRoomInvites(options.wx, receiveInvite)

  function requestLoginCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      options.wx.login({
        success(result) {
          if (result.code) resolve(result.code)
          else reject(new Error('WECHAT_LOGIN_EMPTY_CODE'))
        },
        fail(error) {
          reject(new Error(`WECHAT_LOGIN_FAILED: ${errorMessage(error)}`))
        },
      })
    })
  }

  function login(force = false): Promise<WechatAccount> {
    if (!force && authSession) return Promise.resolve(authSession)
    if (loginPromise) return loginPromise
    if (force) clearAuthSession(false)
    loginPromise = (async () => {
      const code = await requestLoginCode()
      const account = await http.request<WechatAccount>('/api/auth/wechat', {
        method: 'POST',
        body: { code },
      })
      if (!account.accessToken || !account.playerId || !Number.isFinite(account.expiresAt)) {
        throw new Error('INVALID_WECHAT_LOGIN_RESPONSE')
      }
      if (account.expiresAt <= now() / 1000 + EXPIRY_SKEW_SECONDS) {
        throw new Error('WECHAT_LOGIN_ALREADY_EXPIRED')
      }
      saveAuthSession(account)
      return account
    })().finally(() => { loginPromise = null })
    return loginPromise
  }

  function logout() {
    clearAuthSession(true)
  }

  async function authenticatedRequest<T>(path: string, init: WechatRequestOptions = {}): Promise<T> {
    await login()
    try {
      return await http.request<T>(path, init)
    } catch (error) {
      if (!(error instanceof WechatRemoteApiError) || error.status !== 401) throw error
      await login(true)
      return http.request<T>(path, init)
    }
  }

  async function shareRoom(roomId: string): Promise<WechatRoomInviteResponse> {
    const invite = await authenticatedRequest<WechatRoomInviteResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/invites`,
      { method: 'POST' },
    )
    options.wx.shareAppMessage({
      title: `三缺一，点击加入房间 ${invite.roomId}`,
      ...(options.shareImageUrl ? { imageUrl: options.shareImageUrl } : {}),
      query: buildRoomInviteQuery({ roomId: invite.roomId, ticket: invite.inviteTicket }),
    })
    return invite
  }

  async function joinPendingInvite(nickname: string): Promise<WechatJoinInviteResponse> {
    if (!pendingInvite) throw new Error('ROOM_INVITE_NOT_FOUND')
    const invite = pendingInvite
    const joined = await authenticatedRequest<WechatJoinInviteResponse>(
      `/api/rooms/${encodeURIComponent(invite.roomId)}/join-by-invite`,
      {
        method: 'POST',
        body: { inviteTicket: invite.ticket, nickname },
      },
    )
    sessionStore.saveNickname(joined.nickname)
    sessionStore.saveSession({
      roomId: joined.roomId,
      rejoinCode: joined.rejoinCode,
      nickname: joined.nickname,
      playerId: joined.playerId,
      mode: joined.mode,
      rulesetId: joined.rulesetId,
    })
    pendingInvite = null
    return joined
  }

  return {
    http,
    sessionStore,
    socketFactory,
    login,
    ensureLogin: () => login(),
    refreshLogin: () => login(true),
    logout,
    authenticatedRequest,
    shareRoom,
    joinPendingInvite,
    getPendingInvite: () => pendingInvite,
    getAuthSession: () => authSession,
    onRoomInvite(listener: (invite: RoomInvite) => void) {
      inviteListeners.add(listener)
      if (pendingInvite) listener(pendingInvite)
      return () => inviteListeners.delete(listener)
    },
    destroy: stopInviteListener,
  }
}

export type WechatGameRuntime = ReturnType<typeof createWechatGameRuntime>
