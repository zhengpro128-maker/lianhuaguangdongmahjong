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
  expiresAt: number
}

export interface WechatJoinInviteResponse {
  roomId: string
  seat: number
  nickname: string
  playerId: string
  rejoinCode: string
  mode: MatchType
  rulesetId?: RuleVariant
  rejoin?: boolean
}

export interface WechatRoomInfo {
  roomId: string
  mode: MatchType
  rulesetId: RuleVariant
  capacity: number
  status: 'lobby' | 'playing' | 'finished' | 'error' | 'closed'
  creatorSeat: number | null
  seats: Array<{
    seat: number
    nickname: string
    characterId: string
    ready: boolean
    connected: boolean
  } | null>
}

export interface CreateWechatRoomOptions {
  nickname: string
  mode?: MatchType
  capacity?: number
  rulesetId?: RuleVariant
  characterId?: string
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

  function normalizeNickname(nickname: string): string {
    const value = nickname.trim()
    if (!value || value.length > 20) throw new Error('INVALID_NICKNAME')
    return value
  }

  function saveJoinedRoom(joined: WechatJoinInviteResponse) {
    sessionStore.saveGuestId(joined.playerId)
    sessionStore.saveNickname(joined.nickname)
    sessionStore.saveSession({
      roomId: joined.roomId,
      seat: joined.seat,
      rejoinCode: joined.rejoinCode,
      nickname: joined.nickname,
      playerId: joined.playerId,
      mode: joined.mode,
      rulesetId: joined.rulesetId,
    })
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

  async function joinRoom(roomId: string, nickname: string,
    characterId?: string): Promise<WechatJoinInviteResponse> {
    const joined = await authenticatedRequest<WechatJoinInviteResponse>(
      `/api/rooms/${encodeURIComponent(roomId.trim().toUpperCase())}/join`,
      {
        method: 'POST',
        body: { nickname: normalizeNickname(nickname), characterId },
      },
    )
    saveJoinedRoom(joined)
    return joined
  }

  async function createRoom(roomOptions: CreateWechatRoomOptions): Promise<WechatJoinInviteResponse> {
    const created = await authenticatedRequest<WechatRoomInfo>('/api/rooms', {
      method: 'POST',
      body: {
        mode: roomOptions.mode ?? 'east',
        capacity: roomOptions.capacity ?? 4,
        rulesetId: roomOptions.rulesetId ?? 'lotus-classic',
      },
    })
    return joinRoom(created.roomId, roomOptions.nickname, roomOptions.characterId)
  }

  async function getCurrentRoom(): Promise<WechatRoomInfo | null> {
    const session = sessionStore.loadSession()
    if (!session) return null
    try {
      return await authenticatedRequest<WechatRoomInfo>(
        `/api/rooms/${encodeURIComponent(session.roomId)}`,
      )
    } catch (error) {
      // A persisted room can disappear after the server expires or closes it. Treat that as
      // a completed restore instead of trapping every subsequent launch on a startup error.
      if (error instanceof WechatRemoteApiError && (error.status === 404 || error.status === 410)) {
        sessionStore.clearSession()
        return null
      }
      throw error
    }
  }

  async function leaveCurrentRoom(): Promise<void> {
    const session = sessionStore.loadSession()
    if (!session) return
    if (!Number.isInteger(session.seat)) throw new Error('ROOM_SESSION_SEAT_MISSING')
    await authenticatedRequest(`/api/rooms/${encodeURIComponent(session.roomId)}/leave`, {
      method: 'POST',
      body: { seat: session.seat, rejoinCode: session.rejoinCode },
    })
    sessionStore.clearSession()
  }

  async function setReady(ready: boolean): Promise<boolean> {
    const session = sessionStore.loadSession()
    if (!session || !Number.isInteger(session.seat)) throw new Error('ROOM_SESSION_NOT_FOUND')
    const result = await authenticatedRequest<{ ready: boolean }>(
      `/api/rooms/${encodeURIComponent(session.roomId)}/ready`,
      {
        method: 'POST',
        body: { seat: session.seat, rejoinCode: session.rejoinCode, ready },
      },
    )
    return result.ready
  }

  async function startCurrentRoom(): Promise<void> {
    const session = sessionStore.loadSession()
    if (!session) throw new Error('ROOM_SESSION_NOT_FOUND')
    await authenticatedRequest(`/api/rooms/${encodeURIComponent(session.roomId)}/start`, {
      method: 'POST',
      body: {},
    })
  }

  async function connectCurrentRoom() {
    const session = sessionStore.loadSession()
    if (!session) throw new Error('ROOM_SESSION_NOT_FOUND')
    await login()
    const websocketBase = options.apiBase.replace(/^http/i, 'ws').replace(/\/+$/, '')
    return socketFactory(
      `${websocketBase}/ws/room/${encodeURIComponent(session.roomId)}`
      + `?rejoin_code=${encodeURIComponent(session.rejoinCode)}`,
    )
  }

  async function shareRoom(roomId: string): Promise<WechatRoomInviteResponse> {
    const normalizedRoomId = roomId.trim().toUpperCase()
    const invite = await authenticatedRequest<WechatRoomInviteResponse>(
      `/api/rooms/${encodeURIComponent(normalizedRoomId)}/invites`,
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
        body: { inviteTicket: invite.ticket, nickname: normalizeNickname(nickname) },
      },
    )
    saveJoinedRoom(joined)
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
    createRoom,
    joinRoom,
    getCurrentRoom,
    leaveCurrentRoom,
    setReady,
    startCurrentRoom,
    connectCurrentRoom,
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
