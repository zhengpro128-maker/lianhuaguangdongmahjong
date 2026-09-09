import { describe, expect, it, vi } from 'vitest'
import { buildRoomInviteQuery, listenForRoomInvites, parseRoomInvite } from './invite'

describe('wechat room invite', () => {
  it('normalizes and validates launch query', () => {
    expect(parseRoomInvite({ query: { room: 'ab12cd', ticket: ' signed ' } })).toEqual({
      roomId: 'AB12CD',
      ticket: 'signed',
    })
    expect(parseRoomInvite({ query: { room: 'ABC', ticket: 'signed' } })).toBeNull()
    expect(parseRoomInvite({ query: { room: 'ABC123' } })).toBeNull()
  })

  it('builds an encoded share query without exposing a rejoin code', () => {
    expect(buildRoomInviteQuery({ roomId: 'ABC123', ticket: 'a+b/=' }))
      .toBe('room=ABC123&ticket=a%2Bb%2F%3D')
  })

  it('handles cold and warm launches once per invite', () => {
    let onShow: ((value: { query?: Record<string, string> }) => void) | undefined
    const listener = vi.fn()
    listenForRoomInvites({
      getLaunchOptionsSync: () => ({ query: { room: 'ABC123', ticket: 'one' } }),
      onShow: (callback) => { onShow = callback },
    }, listener)

    expect(listener).toHaveBeenCalledWith({ roomId: 'ABC123', ticket: 'one' })
    onShow?.({ query: { room: 'ABC123', ticket: 'one' } })
    onShow?.({ query: { room: 'ABC123', ticket: 'two' } })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
