import type { WxGameApi, WxLaunchOptions } from './wx'

export interface RoomInvite {
  roomId: string
  ticket: string
}

const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/
const MAX_TICKET_LENGTH = 1024

export function parseRoomInvite(options: WxLaunchOptions | null | undefined): RoomInvite | null {
  const roomId = options?.query?.room?.trim().toUpperCase() ?? ''
  const ticket = options?.query?.ticket?.trim() ?? ''
  if (!ROOM_ID_PATTERN.test(roomId)) return null
  if (!ticket || ticket.length > MAX_TICKET_LENGTH) return null
  return { roomId, ticket }
}

export function buildRoomInviteQuery(invite: RoomInvite): string {
  if (!ROOM_ID_PATTERN.test(invite.roomId)) throw new Error('INVALID_ROOM_ID')
  if (!invite.ticket || invite.ticket.length > MAX_TICKET_LENGTH) throw new Error('INVALID_INVITE_TICKET')
  return `room=${encodeURIComponent(invite.roomId)}&ticket=${encodeURIComponent(invite.ticket)}`
}

export function listenForRoomInvites(
  wx: Pick<WxGameApi, 'getLaunchOptionsSync' | 'onShow'>,
  onInvite: (invite: RoomInvite) => void,
): () => void {
  let active = true
  let lastInviteKey = ''

  const handleOptions = (options: WxLaunchOptions) => {
    if (!active) return
    const invite = parseRoomInvite(options)
    if (!invite) return
    const key = `${invite.roomId}:${invite.ticket}`
    if (key === lastInviteKey) return
    lastInviteKey = key
    onInvite(invite)
  }

  handleOptions(wx.getLaunchOptionsSync())
  wx.onShow(handleOptions)
  return () => { active = false }
}
