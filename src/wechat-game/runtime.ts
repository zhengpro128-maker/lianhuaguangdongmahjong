import { createRemoteSessionStore } from '../game/online/session/remoteSessionStore'
import type { MatchType } from '../game/core/contracts/types'
import type { RuleVariant } from '../game/core/rules/ruleVariants'
import { createWechatHttpClient } from './http'
import { buildRoomInviteQuery, listenForRoomInvites, type RoomInvite } from './invite'
import { createWechatSocketFactory } from './socket'
import { createWechatStorage } from './storage'
import { errorMessage, type WxGameApi } from './wx'

const ACCESS_TOKEN_KEY = 'lgm_wechat_access_token'

export interface WechatAccount {
  playerId: string
  accessToken: string
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
}) {
  const storage = createWechatStorage(options.wx)
  let accessToken = storage.getItem(ACCESS_TOKEN_KEY)
  let pendingInvite: RoomInvite | null = null
  const inviteListeners = new Set<(invite: RoomInvite) => void>()

  const http = createWechatHttpClient({
    wx: options.wx,
    baseUrl: options.apiBase,
    getAccessToken: () => accessToken,
  })
  const sessionStore = createRemoteSessionStore(() => storage)
  const socketFactory = createWechatSocketFactory(options.wx, () => accessToken)

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

  async function login(): Promise<WechatAccount> {
    const code = await requestLoginCode()
    const account = await http.request<WechatAccount>('/api/auth/wechat', {
      method: 'POST',
      body: { code },
    })
    if (!account.accessToken || !account.playerId) throw new Error('INVALID_WECHAT_LOGIN_RESPONSE')
    accessToken = account.accessToken
    storage.setItem(ACCESS_TOKEN_KEY, accessToken)
    sessionStore.saveGuestId(account.playerId)
    return account
  }

  function logout() {
    accessToken = null
    storage.removeItem(ACCESS_TOKEN_KEY)
    sessionStore.clearSession()
  }

  async function shareRoom(roomId: string): Promise<WechatRoomInviteResponse> {
    if (!accessToken) await login()
    const invite = await http.request<WechatRoomInviteResponse>(
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
    if (!accessToken) await login()
    const invite = pendingInvite
    const joined = await http.request<WechatJoinInviteResponse>(
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
    logout,
    shareRoom,
    joinPendingInvite,
    getPendingInvite: () => pendingInvite,
    onRoomInvite(listener: (invite: RoomInvite) => void) {
      inviteListeners.add(listener)
      if (pendingInvite) listener(pendingInvite)
      return () => inviteListeners.delete(listener)
    },
    destroy: stopInviteListener,
  }
}

export type WechatGameRuntime = ReturnType<typeof createWechatGameRuntime>
