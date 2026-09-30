import { describe, it, expect, vi } from 'vitest'
import { MiniHud } from '../src/hud.js'

function makeHud() {
  const gradient = { addColorStop() {} }
  const ctx = new Proxy({ fillText: vi.fn(), arc: vi.fn(), lineTo: vi.fn(),
    measureText: text => ({ width: text.length * 7 }), createLinearGradient: () => gradient,
    createRadialGradient: () => gradient }, { get: (target, key) => target[key] ?? (() => {}) })
  const onAction = vi.fn()
  const hud = new MiniHud({ createCanvas: () => ({ getContext: () => ctx }), createImage: () => ({}), onAction })
  hud.resize({ windowWidth: 667, windowHeight: 320, pixelRatio: 2 })
  return { hud, ctx, onAction }
}

describe('sound control', () => {
  it.each(['lobby', 'game'])('shows a distinct current state and retains the sound toggle in %s', screen => {
    const { hud, ctx, onAction } = makeHud()
    const boxes = vi.spyOn(hud, 'box')
    const fills = []
    for (const soundEnabled of [true, false]) {
      boxes.mockClear(); ctx.fillText.mockClear()
      hud.update({ phase: screen === 'lobby' ? 'lobby' : 'discard', screen, soundEnabled, players: [] })
      const hit = hud.hitRegions.find(hit => hit.action.type === 'sound')
      expect(hit).toBeTruthy()
      expect(hit.x + hit.w).toBeLessThanOrEqual(hud.width)
      expect(hit.y + hit.h).toBeLessThanOrEqual(hud.height)
      fills.push(boxes.mock.calls.find(([x, y, w, h]) => x === hit.x && y === hit.y && w === hit.w && h === hit.h)[4])
      const label = screen === 'lobby' ? (soundEnabled ? '声音：开' : '声音：关') : (soundEnabled ? '声音' : '静音')
      expect(ctx.fillText.mock.calls.some(([text, x, y]) => text === label && x > hit.x && x < hit.x + hit.w && y === hit.y + hit.h / 2)).toBe(true)
      hud.handleTouch(hit.x + hit.w / 2, hit.y + hit.h / 2)
      expect(onAction).toHaveBeenLastCalledWith({ type: 'sound' })
    }
    expect(fills[0]).not.toBe(fills[1])
  })

  it('draws speaker waves while enabled and a crossed speaker while muted without using a font icon', () => {
    const { hud, ctx } = makeHud()
    ctx.arc.mockClear()
    hud.state = { soundEnabled: true }
    hud.soundButton(0, 0, 42, 28, true)
    expect(ctx.arc).toHaveBeenCalledTimes(2)
    ctx.arc.mockClear(); ctx.lineTo.mockClear()
    hud.state = { soundEnabled: false }
    hud.soundButton(0, 0, 42, 28, true)
    expect(ctx.arc).not.toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenLastCalledWith(16, 20)
  })
})
