import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWuhanGame } from './useWuhanGame'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function stubWindow() {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  })
}

describe('武汉晃晃可玩闭环', () => {
  it('可由四个控制器自动打到结算且 120 张牌守恒', async () => {
    stubWindow()
    const game = useWuhanGame({ playSound: () => {}, playSoundAndWait: async () => {} })
    const start = game.startGame('east')
    for (let step = 0; step < 4000 && game.phase.value !== 'settled'; step += 1) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    await start
    expect(game.phase.value).toBe('settled')
    expect(game.wall.value.length).toBeGreaterThanOrEqual(8)
    const inPlay = game.wall.value.length + game.players.reduce((total, player) => (
      total + player.hand.length + player.discards.length
      + player.melds.reduce((meldTotal, meld) => meldTotal + meld.tiles.length, 0)
    ), 0) + (game.winPresentation.value?.discardWin ? 1 : 0)
    expect(inPlay).toBe(120)
    expect(game.players.reduce((total, player) => total + player.score, 0)).toBe(4000)
  }, 30_000)
})
