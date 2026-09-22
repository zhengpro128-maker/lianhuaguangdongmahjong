import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMiniGame } from './game-bridge'
import type { useWuhanGame } from '../../src/game/variants/wuhan/useWuhanGame'
import type { GamePlayer, TileType } from '../../src/game/core/contracts/types'
import { WUHAN_RULESET } from '../../src/game/variants/wuhan/rules'

// Capture the real public browser port at its factory boundary. The shipped bridge
// has no debug hook and all requests below use its actual HumanController.
const captured = vi.hoisted(() => ({ port: null as ReturnType<typeof useWuhanGame> | null }))
vi.mock('../../src/game/variants/wuhan/useWuhanGame', async (original) => {
  const module = await original<typeof import('../../src/game/variants/wuhan/useWuhanGame')>()
  return { ...module, useWuhanGame: (...args: Parameters<typeof useWuhanGame>) => {
    captured.port = module.useWuhanGame(...args)
    return captured.port
  } }
})

let bridge: ReturnType<typeof createMiniGame>
function player(hand: TileType[], seat = 0): GamePlayer {
  return { name: `玩家${seat}`, avatar: '', score: 1000, seat, hand, melds: [], discards: [], redCount: 0, drawnTileIndex: -1 }
}
const ordinary: TileType[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p2', 'p3', 'p4', 's6', 's7', 's8', 'white']
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('localStorage', undefined)
  bridge = createMiniGame()
  captured.port!.players.push(player([...ordinary]), player([], 1), player([], 2), player([], 3))
  captured.port!.currentPlayer.value = 0
})
afterEach(() => { bridge.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
function context() {
  const port = captured.port!, user = port.players[0]
  return { hand: user.hand, melds: user.melds, exposedMelds: user.melds.filter(m => m.type !== 'flower').length,
    jokers: [], tile: 'm3' as TileType, from: 3, canPeng: true, canGang: true,
    chiOptions: [
      { tiles: ['m1', 'm2', 'm3'] as TileType[], kind: 'sequence' as const },
      { tiles: ['m2', 'm3', 'm4'] as TileType[], kind: 'sequence' as const },
    ], ruleset: WUHAN_RULESET }
}

describe('mini game action routing to browser controllers', () => {
  it.each([
    ['peng', { kind: 'peng' }],
    ['gang-discard', { kind: 'gang' }],
    ['pass', { kind: 'pass' }],
  ] as const)('resolves a real claim window with %s', async (id, expected) => {
    const request = captured.port!.humanController.requestClaim(context())
    expect(bridge.snapshot().actions.map(item => item.id)).toEqual(['peng', 'gang-discard', 'chi:0', 'chi:1', 'pass'])
    expect(bridge.action('hu')).toBe(false)
    expect(bridge.action(id)).toBe(true)
    await expect(request).resolves.toEqual(expected)
    expect(bridge.action(id)).toBe(false)
  })

  it('selects the requested chi group for the ordinary chi window and combined claim window', async () => {
    for (const method of ['requestChi', 'requestClaim'] as const) {
      const ctx = context()
      const request = captured.port!.humanController[method](ctx)
      await nextTick()
      expect(bridge.action('chi:99')).toBe(false)
      expect(bridge.action('chi:1')).toBe(true)
      await expect(request).resolves.toEqual({ kind: 'chi', meld: ctx.chiOptions[1] })
      await nextTick()
    }
  })

  it.each(['hu', 'pass'] as const)('resolves a discard-win offer with %s', async id => {
    const request = captured.port!.humanController.requestDiscardHu({ ...context(), dihu: false })
    expect(bridge.snapshot().actions.some(item => item.id === 'hu')).toBe(true)
    expect(bridge.action(id)).toBe(true)
    await expect(request).resolves.toEqual({ kind: id === 'hu' ? 'win' : 'pass' })
  })

  it.each(['hu', 'pass'] as const)('resolves a rob-kong offer with %s', async id => {
    const request = captured.port!.humanController.requestRobKong(context())
    expect(bridge.snapshot().actions.map(item => item.id)).toEqual(['hu', 'pass'])
    expect(bridge.action(id)).toBe(true)
    await expect(request).resolves.toEqual(id === 'hu' ? 'win' : 'pass')
  })

  it('dispatches a concealed kong using the exact offered tile', async () => {
    const port = captured.port!
    port.players[0].hand = ['m1', 'm1', 'm1', 'm1', ...ordinary.slice(3)]
    const request = port.humanController.requestTurn({ ...context(), kongBloom: false, skipDraw: false, isDealer: true })
    expect(bridge.snapshot().actions).toContainEqual({ id: 'gang:m1', type: 'gang', label: '杠', tile: 'm1' })
    expect(bridge.action('gang:m2')).toBe(false)
    expect(bridge.action('gang:m1')).toBe(true)
    await expect(request).resolves.toEqual({ kind: 'concealed-kong', tile: 'm1' })
  })

  it('dispatches an added kong to the matching existing peng', async () => {
    const port = captured.port!
    port.players[0].hand = ['m1', ...ordinary.slice(3)]
    port.players[0].melds = [{ type: 'peng', tile: 'm1', tiles: ['m1', 'm1', 'm1'], from: 2 }]
    const request = port.humanController.requestTurn({ ...context(), kongBloom: false, skipDraw: false, isDealer: true })
    expect(bridge.action('gang:m1')).toBe(true)
    await expect(request).resolves.toEqual({ kind: 'added-kong', meldIndex: 0 })
  })

  it('dispatches a legal self-draw win through the browser legality selector', async () => {
    const port = captured.port!
    port.players[0].hand = [...ordinary, 'white']
    const request = port.humanController.requestTurn({ ...context(), kongBloom: false, skipDraw: false, isDealer: true })
    expect(bridge.snapshot().userCanHu).toBe(true)
    expect(bridge.action('hu')).toBe(true)
    await expect(request).resolves.toEqual({ kind: 'win' })
  })

  it('keeps a claim pending in the background, resumes autoplay, and cancels scheduled autoplay when disabled', async () => {
    const request = captured.port!.humanController.requestRobKong(context())
    bridge.setAutoPlay(true)
    bridge.pause()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(captured.port!.humanController.hasPendingRobKong()).toBe(true)
    bridge.resume()
    bridge.setAutoPlay(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(captured.port!.humanController.hasPendingRobKong()).toBe(true)
    bridge.setAutoPlay(true)
    await vi.advanceTimersByTimeAsync(701)
    await expect(request).resolves.toEqual('win')
  })
})
