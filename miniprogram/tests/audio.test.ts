import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMiniAudio } from '../src/audio.js'

function host() {
  const contexts: any[] = []
  return { contexts, createInnerAudioContext() {
    const events: any = {}
    const ctx = { events, src: '', volume: 0, play: vi.fn(), destroy: vi.fn(),
      onEnded: (fn: any) => { events.ended = fn }, onError: (fn: any) => { events.error = fn },
      onStop: (fn: any) => { events.stop = fn } }
    contexts.push(ctx); return ctx
  } }
}
afterEach(() => vi.useRealTimers())
describe('Mini Game audio lifecycle', () => {
  it('resolves opening audio when interrupted on app hide and releases the player', async () => {
    const wx = host(), audio = createMiniAudio(wx)
    const completed = vi.fn()
    audio.playSound('dice.mp3', 0.5, completed)
    expect(wx.contexts[0].src).toBe('assets/audio/dice.mp3')
    audio.setHidden(true)
    await Promise.resolve()
    expect(completed).toHaveBeenCalledOnce()
    expect(wx.contexts[0].destroy).toHaveBeenCalledOnce()
    await audio.playSoundAndWait('game_start.mp3')
    expect(wx.contexts).toHaveLength(1)
  })
  it('missing sounds and broken platform callbacks cannot stall a round', async () => {
    vi.useFakeTimers()
    const wx = host(), audio = createMiniAudio(wx)
    const first = audio.playSoundAndWait('dice.mp3')
    wx.contexts[0].events.error()
    await first
    const second = audio.playSoundAndWait('deal.mp3')
    await vi.advanceTimersByTimeAsync(6000)
    await second
    expect(wx.contexts.every(ctx => ctx.destroy.mock.calls.length === 1)).toBe(true)
  })
  it('mute/dispose settle all pending sounds and cap simultaneous contexts', async () => {
    const wx = host(), audio = createMiniAudio(wx)
    const sounds = Array.from({ length: 10 }, () => audio.playSoundAndWait('click.mp3'))
    expect(wx.contexts.slice(0, 4).every(ctx => ctx.destroy.mock.calls.length === 1)).toBe(true)
    audio.setEnabled(false)
    await Promise.all(sounds)
    audio.dispose()
    await audio.playSoundAndWait('dice.mp3')
    expect(wx.contexts).toHaveLength(10)
    expect(wx.contexts.every(ctx => ctx.destroy.mock.calls.length === 1)).toBe(true)
  })
})
