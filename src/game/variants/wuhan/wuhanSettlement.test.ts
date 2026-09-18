import { describe, expect, it } from 'vitest'
import type { GamePlayer, TileType } from '../../core/contracts/types'
import { createWuhanSettlement } from './wuhanSettlement'
import { createWuhanGameState } from './wuhanState'

function player(seat: number, hand: TileType[] = []): GamePlayer {
  return { name: String(seat), avatar: '', score: 1000, seat, hand, discards: [], melds: [], redCount: 0, drawnTileIndex: -1 }
}

describe('武汉晃晃点炮胡', () => {
  it('发财作为癞子时也可以胡他家弃牌', () => {
    const state = createWuhanGameState()
    const fullHand: TileType[] = ['m1', 'm1', 'm1', 'm2', 'm2', 'm2', 'p3', 'p3', 'p3', 's4', 's4', 'green', 's9', 's9']
    state.players.push(player(0, fullHand.filter((tile, index) => !(tile === 'p3' && index === 8))), player(1), player(2), player(3))
    state.jokerTiles.value = ['green']
    const settlement = createWuhanSettlement({
      state,
      clearTimers: () => {},
      later: () => 0,
      playSound: () => {},
      showTableAction: () => {},
      structuralMeldCount: () => 0,
      getRoundLabel: () => '',
    })

    expect(settlement.isLegalWin(0, { winTile: 'p3', winHand: fullHand, sourceFrom: 1 })).toBe(true)
  })
})
