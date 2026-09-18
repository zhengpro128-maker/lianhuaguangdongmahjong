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

  it('两张癞子的杠上开花在牌型完整时可以胡', () => {
    const state = createWuhanGameState()
    // 1-2-3 万、3 筒对子、5-6-7 筒、9 筒加两张 8 条癞子补成刻子；
    // 另有一副暗杠，且刚以癞子单杠从牌尾补摸。
    const hand: TileType[] = ['m1', 'm2', 'm3', 'p3', 'p3', 'p5', 'p6', 'p7', 'p9', 's8', 's8']
    const winner = player(0, hand)
    winner.melds.push(
      { type: 'angang', tile: 'm9', tiles: ['m9', 'm9', 'm9', 'm9'] },
      { type: 'flower', tile: 's8', tiles: ['s8'], specialKong: 'joker' },
    )
    state.players.push(winner, player(1), player(2), player(3))
    state.jokerTiles.value = ['s8']
    const settlement = createWuhanSettlement({
      state,
      clearTimers: () => {},
      later: () => 0,
      playSound: () => {},
      showTableAction: () => {},
      structuralMeldCount: (playerIndex) => state.players[playerIndex].melds.filter((meld) => meld.type !== 'flower').length,
      getRoundLabel: () => '',
    })

    expect(settlement.isLegalWin(0, { selfDraw: true, kongBloom: true })).toBe(true)
  })
})
