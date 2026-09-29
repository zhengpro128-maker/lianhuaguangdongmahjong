import { describe, expect, it } from 'vitest'
import { validSocialPayload, validSocialEvent } from './roomSocial'

describe('room social wire validation', () => {
  it('rejects malformed, unknown and self-targeted events', () => {
    const event = { kind: 'room_social', id: 'event-1', category: 'prop', value: 'tomato', seat: 1, targetSeat: 2 }
    expect(validSocialEvent(event)).toBe(true)
    for (const patch of [{ seat: 4 }, { targetSeat: 1 }, { targetSeat: '2' }, { value: 'unknown' }, { id: '' }]) {
      expect(validSocialEvent({ ...event, ...patch })).toBe(false)
    }
  })
  it('counts Unicode characters and rejects blank, oversized or control-bearing text', () => {
    expect(validSocialPayload({ category: 'text', value: '😀'.repeat(60) })).toBe(true)
    for (const value of ['', '  ', '😀'.repeat(61), 'a\nb', 'a\x00b']) expect(validSocialPayload({ category: 'text', value })).toBe(false)
  })
})
