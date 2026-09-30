import { describe, expect, it } from 'vitest'
import { activeSocialProps, getSocialFeedbackCues, socialPropLane, socialSeatReaction, SOCIAL_PROP_TIMINGS } from '../src/social-effects.js'

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

  it('three attackers get separate placements that stay consistent across all four viewers', () => {
    const burst = [0, 1, 2].map(seat => ({ ...event('coffee'), id: `coffee-${seat}`, seat, targetSeat: 3, receivedAt: 1000 + seat * 10 }))
    const placements = burst.map(e => socialPropLane(e, burst))
    expect(new Set(placements).size).toBe(3)
    for (const viewer of [0, 1, 2, 3]) {
      const rotated = burst.map(e => ({ ...e, seat: (e.seat - viewer + 4) % 4, targetSeat: (e.targetSeat - viewer + 4) % 4 }))
      expect(rotated.map(e => socialPropLane(e, rotated))).toEqual(placements)
    }
    expect(socialPropLane(burst[0], [burst[0]])).toBe(0)
    const later = { ...burst[0], id: 'next-burst', receivedAt: 3000 }
    expect(socialPropLane(later, [...burst, later])).toBe(0)
  })

  it('two legal bursts two seconds apart keep bounded animations and recover without deleting history', () => {
    const attacks = receivedAt => [1, 2, 3].map(seat => ({ ...event('coffee'), id: `${seat}-${receivedAt}`, seat, receivedAt }))
    const history = [...attacks(1000), ...attacks(3000)]
    const active = activeSocialProps(history, 3200)
    expect(active).toHaveLength(4)
    expect(active.slice(-3).map(e => e.id)).toEqual(history.slice(-3).map(e => e.id))
    expect(history).toHaveLength(6)
    const reaction = socialSeatReaction(history, 0, 4280)
    expect(reaction.sx).toBeLessThanOrEqual(1.16)
    expect(reaction.sy).toBeGreaterThanOrEqual(.78)
    expect(socialSeatReaction(history, 0, 6600)).toEqual(idle)
    expect(activeSocialProps(history, 6600)).toEqual([])
  })
})
