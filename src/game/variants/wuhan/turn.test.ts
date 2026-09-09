import { describe, expect, it } from 'vitest'
import { startWuhanRound } from './gameState'
import { canDiscardWuhanTile, performWuhanRedKong } from './turn'

describe('武汉晃晃回合动作', () => {
  it('forbids red discard and replaces a single red kong from the tail', () => {
    const state = startWuhanRound(0, [1, 1], () => 0.3)
    state.hands[0] = state.hands[0].filter(tile => tile !== 'red')
    state.hands[0].push('red')
    const before = state.hands[0].length
    expect(canDiscardWuhanTile('red')).toBe(false)
    expect(performWuhanRedKong(state, 0).kind).toBe('tile')
    expect(state.redKongs[0]).toBe(1)
    expect(state.hands[0]).toHaveLength(before)
    expect(state.hands[0]).not.toContain('red')
  })
})
