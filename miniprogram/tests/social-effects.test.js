import { describe, expect, it } from 'vitest'
import { activeSocialProps, getSocialFeedbackCues, socialSeatReaction, SOCIAL_PROP_TIMINGS } from '../src/social-effects.js'

const event = value => ({ kind: 'room_social', id: value, category: 'prop', value, seat: 1, targetSeat: 0, receivedAt: 1000 })
const idle = { x: 0, y: 0, rotation: 0, sx: 1, sy: 1 }

describe('social prop choreography', () => {
  it.each(['tomato', 'coffee', 'hammer'])('%s reacts on the addressed player at impact and clears after the effect', prop => {
    const e = event(prop), timing = SOCIAL_PROP_TIMINGS[prop]
    expect(socialSeatReaction([e], 0, e.receivedAt + timing.hit - 1)).toEqual(idle)
    const hit = socialSeatReaction([e], 0, e.receivedAt + timing.hit)
    expect(hit.sx).toBeGreaterThan(1)
    expect(hit.sy).toBeLessThan(1)
    expect(socialSeatReaction([e], 2, e.receivedAt + timing.hit)).toEqual(idle)
    expect(socialSeatReaction([e], 0, e.receivedAt + timing.end)).toEqual(idle)
    expect(activeSocialProps([e], e.receivedAt + timing.end)).toEqual([])
  })

  it('the second hammer strike compresses the target again, and simultaneous hits stay bounded', () => {
    const e = event('hammer'), now = e.receivedAt + SOCIAL_PROP_TIMINGS.hammer.secondHit
    expect(socialSeatReaction([e], 0, now).sy).toBeLessThan(.86)
    const reaction = socialSeatReaction(Array.from({ length: 12 }, () => e), 0, now)
    expect(reaction.sy).toBeGreaterThanOrEqual(.78)
    expect(reaction.sx).toBeLessThanOrEqual(1.16)
    expect(activeSocialProps(Array.from({ length: 12 }, () => e), now)).toHaveLength(4)
  })

  it('coffee touch feedback follows liquid contact rather than the start of pouring', () => {
    const cues = getSocialFeedbackCues(event('coffee'))
    expect(cues.find(c => c.sound === 'social_coffee.wav').at).toBe(SOCIAL_PROP_TIMINGS.coffee.pour)
    expect(cues.find(c => c.haptic).at).toBe(SOCIAL_PROP_TIMINGS.coffee.hit)
    expect(getSocialFeedbackCues({ category: 'text', value: 'hello' })).toEqual([])
  })
})
