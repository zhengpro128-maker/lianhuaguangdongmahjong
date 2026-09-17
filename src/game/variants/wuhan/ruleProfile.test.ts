import { describe, expect, it } from 'vitest'
import type { Meld } from '../../core/contracts/types'
import {
  WUHAN_DRAW_STOP_COUNT, WUHAN_TILE_TYPES, WUHAN_WALL_SIZE, capWuhanPayment,
  createWuhanWall, wuhanJokerForIndicator, wuhanKongMultiplier, wuhanPlayersKongKinds,
} from './ruleProfile'

describe('武汉晃晃规则档案', () => {
  it('uses exactly 120 tiles and excludes winds', () => {
    const wall = createWuhanWall(() => 0.5)
    expect(wall).toHaveLength(WUHAN_WALL_SIZE)
    expect(WUHAN_TILE_TYPES).not.toContain('east')
    expect(WUHAN_TILE_TYPES.every((tile) => wall.filter((item) => item === tile).length === 4)).toBe(true)
  })

  it('uses the agreed explicit joker mapping', () => {
    expect(wuhanJokerForIndicator('m9')).toBe('m1')
    expect(wuhanJokerForIndicator('red')).toBe('green')
    expect(wuhanJokerForIndicator('green')).toBe('white')
    expect(wuhanJokerForIndicator('white')).toBe('green')
  })

  it('multiplies kong fan and caps each payer at 50', () => {
    expect(wuhanKongMultiplier(['red', 'concealed', 'added'])).toBe(16)
    expect(capWuhanPayment(51)).toBe(50)
    expect(capWuhanPayment(8)).toBe(8)
    expect(WUHAN_DRAW_STOP_COUNT).toBe(8)
  })

  it('counts kongs from all four players when settling a win', () => {
    const players: ReadonlyArray<{ melds: readonly Meld[] }> = [
      { melds: [{ type: 'flower', tile: 'red', tiles: ['red'] }] },
      { melds: [{ type: 'gang', tile: 'm1', tiles: ['m1', 'm1', 'm1', 'm1'], added: false }] },
      { melds: [{ type: 'angang', tile: 'p2', tiles: ['p2', 'p2', 'p2', 'p2'] }] },
      { melds: [{ type: 'flower', tile: 'white', tiles: ['white'] }] },
    ]

    expect(wuhanPlayersKongKinds(players, 'white')).toEqual(['red', 'discard', 'concealed', 'joker'])
  })
})
