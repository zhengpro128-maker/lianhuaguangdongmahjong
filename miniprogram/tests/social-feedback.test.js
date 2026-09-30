import { describe, expect, it, vi } from 'vitest'
import { createSocialFeedback } from '../src/social-feedback.js'
import { createSocialAudioAssets } from '../scripts/social-audio.mjs'

const cues = [
  { at: 180, sound: 'social_throw.wav', volume: .35 },
  { at: 900, sound: 'social_tomato.wav', volume: .55, haptic: 'light' },
]
function setup() {
  const playSound = vi.fn(), vibrateShort = vi.fn()
  const feedback = createSocialFeedback({ getCues: () => cues, playSound, vibrateShort })
  const event = { id: 'tomato-1', receivedAt: 1000, seat: 2, targetSeat: 0 }
  const state = { phase: 'turn', socialSession: 1, user: { seat: 0 }, socialEvents: [event] }
  return { feedback, playSound, vibrateShort, state }
}

describe('social effect feedback clock', () => {
  it('plays launch and impact once and only vibrates the local target', () => {
    const { feedback, playSound, vibrateShort, state } = setup()
    feedback.update(state, { now: 1179 })
    expect(playSound).not.toHaveBeenCalled()
    feedback.update(state, { now: 1180 })
    feedback.update(state, { now: 1190 })
    expect(playSound).toHaveBeenCalledExactlyOnceWith('social_throw.wav', .35)
    feedback.update(state, { now: 1900 })
    feedback.update(state, { now: 1901 })
    expect(playSound).toHaveBeenCalledTimes(2)
    expect(vibrateShort).toHaveBeenCalledExactlyOnceWith({ type: 'light', fail: expect.any(Function) })
    feedback.update({ ...state, socialEvents: [{ ...state.socialEvents[0], id: 'other', targetSeat: 1 }] }, { now: 1900 })
    expect(vibrateShort).toHaveBeenCalledTimes(1)
  })

  it('drops cues more than 350 ms late and does not replay them after a clock stall', () => {
    const { feedback, playSound, state } = setup()
    feedback.update(state, { now: 1531 })
    expect(playSound).not.toHaveBeenCalled()
    feedback.update(state, { now: 1900 })
    expect(playSound).toHaveBeenCalledExactlyOnceWith('social_tomato.wav', .55)
    feedback.update(state, { now: 14000 })
    expect(playSound).toHaveBeenCalledTimes(1)
  })

  it.each([{ enabled: false }, { muted: true }, { visible: false }])('suppresses sound and vibration while %j', flags => {
    const { feedback, playSound, vibrateShort, state } = setup()
    feedback.update(state, { now: 1900, ...flags })
    feedback.update(state, { now: 1910 })
    expect(playSound).not.toHaveBeenCalled()
    expect(vibrateShort).not.toHaveBeenCalled()
  })

  it('drops hidden interactions on resume, releases a disposed clock, and resets with a room session', () => {
    const { feedback, playSound, state } = setup()
    feedback.setHidden(true, 1100)
    feedback.update(state, { now: 1180 })
    feedback.setHidden(false, 1500)
    feedback.update(state, { now: 1900 })
    expect(playSound).not.toHaveBeenCalled()
    const fresh = { ...state, socialSession: 2, socialEvents: [{ ...state.socialEvents[0], receivedAt: 2000 }] }
    feedback.update(fresh, { now: 2180 })
    expect(playSound).toHaveBeenCalledTimes(1)
    feedback.update({ ...fresh, phase: 'lobby' }, { now: 2200 })
    feedback.update({ ...fresh, socialSession: 3 }, { now: 2190 })
    expect(playSound).toHaveBeenCalledTimes(2)
    feedback.dispose()
    feedback.update(fresh, { now: 2900 })
    expect(playSound).toHaveBeenCalledTimes(2)
  })

  it.each(['opening', 'dealing'])('leaves the %s timeline audio uninterrupted without replaying missed impacts', phase => {
    const { feedback, playSound, vibrateShort, state } = setup()
    feedback.update({ ...state, phase }, { now: 1900 })
    feedback.update(state, { now: 1910 })
    expect(playSound).not.toHaveBeenCalled()
    expect(vibrateShort).not.toHaveBeenCalled()
  })

  it('host playback and vibration failures cannot break the render loop', () => {
    const feedback = createSocialFeedback({ getCues: () => cues,
      playSound: () => { throw new Error('audio unavailable') },
      vibrateShort: () => { throw new Error('unsupported vibration') } })
    const { state } = setup()
    expect(() => feedback.update(state, { now: 1900 })).not.toThrow()
  })

  it('supports liquid-hit haptics without starting an empty recording', () => {
    const playSound = vi.fn(), vibrateShort = vi.fn()
    const feedback = createSocialFeedback({ getCues: () => [{ at: 1280, sound: '', volume: 0, haptic: 'light' }],
      playSound, vibrateShort })
    const { state } = setup()
    feedback.update(state, { now: 2280 })
    expect(playSound).not.toHaveBeenCalled()
    expect(vibrateShort).toHaveBeenCalledOnce()
  })
})

describe('original social sound recordings', () => {
  it('emits deterministic, short mono PCM WAVs with headroom and click-free ends', () => {
    const first = createSocialAudioAssets(), second = createSocialAudioAssets()
    expect(first.map(asset => asset.file)).toEqual(['social_throw.wav', 'social_tomato.wav', 'social_coffee.wav', 'social_hammer.wav'])
    first.forEach(({ pcm }, index) => {
      expect(pcm.equals(second[index].pcm)).toBe(true)
      expect(pcm.subarray(0, 4).toString()).toBe('RIFF')
      expect(pcm.subarray(8, 12).toString()).toBe('WAVE')
      expect(pcm.readUInt32LE(4)).toBe(pcm.length - 8)
      expect(pcm.readUInt16LE(20)).toBe(1)
      expect(pcm.readUInt16LE(22)).toBe(1)
      expect(pcm.readUInt32LE(24)).toBe(22050)
      expect(pcm.readUInt16LE(34)).toBe(16)
      const seconds = (pcm.length - 44) / 44100
      expect(seconds).toBeGreaterThan(.1)
      expect(seconds).toBeLessThanOrEqual(.7)
      let peak = 0, sumSquares = 0
      for (let i = 44; i < pcm.length; i += 2) {
        const sample = pcm.readInt16LE(i) / 32767
        peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample
      }
      expect(peak).toBeLessThan(.7)
      expect(Math.sqrt(sumSquares / ((pcm.length - 44) / 2))).toBeGreaterThan(.02)
      expect(pcm.readInt16LE(44)).toBe(0)
      expect(Math.abs(pcm.readInt16LE(pcm.length - 2))).toBeLessThan(100)
    })
  })
})
