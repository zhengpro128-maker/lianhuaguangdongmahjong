import { describe, expect, it } from 'vitest'
import { startWuhanRound } from './gameState'

describe('武汉晃晃开局', () => {
  it('deals fourteen to dealer and thirteen to every other seat', () => {
    const state = startWuhanRound(2, [3, 4], () => 0.37)
    expect(state.hands.map(hand => hand.length)).toEqual([13, 13, 14, 13])
    expect(state.headDrawn).toBe(53)
    expect(state.joker).toBeTruthy()
  })
})
