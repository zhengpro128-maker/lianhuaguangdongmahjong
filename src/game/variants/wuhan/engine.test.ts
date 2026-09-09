import { describe, expect, it } from 'vitest'
import { WuhanEngine } from './engine'
describe('武汉晃晃引擎', () => {
  it('moves from dealer discard to claims and next draw', () => {
    const game = new WuhanEngine(0, [1, 1], () => 0.4)
    const index = game.state.hands[0].findIndex(tile => tile !== 'red')
    game.discard(index); expect(game.phase).toBe('claim')
    game.passClaims(); expect(game.current).toBe(1); expect(game.phase).toBe('draw')
  })
})
