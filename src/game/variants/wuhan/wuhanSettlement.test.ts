import { describe, expect, it } from 'vitest'
import type { GamePlayer, TileType } from '../../core/contracts/types'
import { createWuhanSettlement } from './wuhanSettlement'
import { createWuhanGameState } from './wuhanState'

function player(seat: number, hand: TileType[] = []): GamePlayer {
  return { name: String(seat), avatar: '', score: 1000, seat, hand, discards: [], melds: [], redCount: 0, drawnTileIndex: -1 }
}

describe('武汉晃晃点炮胡', () => {
  it('六对加癞子可自摸或接普通弃牌成七对', () => {
    const state = createWuhanGameState()
    const waiting: TileType[] = ['m5', 'm5', 'p5', 'p5', 'p7', 'p8', 'p8', 'p9', 'p9', 's7', 's7', 's8', 's8']
    state.players.push(player(0, waiting), player(1), player(2), player(3))
    state.jokerTiles.value = ['p7']
    const settlement = createWuhanSettlement({
      state, clearTimers: () => {}, later: () => 0, playSound: () => {},
      showTableAction: () => {}, structuralMeldCount: () => 0, getRoundLabel: () => '',
    })
    expect(settlement.isLegalWin(0, { winTile: 'm1', sourceFrom: 1 })).toBe(true)
    state.players[0].hand.push('m1')
    expect(settlement.isLegalWin(0, { selfDraw: true })).toBe(true)
  })

  it('付款者杠番使硬屁胡达到起胡分数时允许先胡', () => {
    const state = createWuhanGameState()
    const hand: TileType[] = ['m1', 'm2', 'm3', 'm5', 'm6', 's2', 's2']
    const winner = player(0, hand)
    winner.melds.push(
      { type: 'chi', tile: 's3', tiles: ['s3', 's4', 's5'] },
      { type: 'peng', tile: 'green', tiles: ['green', 'green', 'green'] },
    )
    const ponger = player(3, ['m4', 'm4'])
    const specialKong = (tile: TileType, kind: 'red' | 'joker') => ({
      type: 'flower' as const, tile, tiles: [tile], specialKong: kind,
    })
    state.players.push(winner, player(1), player(2), ponger)
    state.jokerTiles.value = ['m7']
    const settlement = createWuhanSettlement({
      state, clearTimers: () => {}, later: () => 0, playSound: () => {},
      showTableAction: () => {},
      structuralMeldCount: (index) => state.players[index].melds.filter(meld => meld.type !== 'flower').length,
      getRoundLabel: () => '',
    })
    expect(settlement.isLegalWin(0, { winTile: 'm4', sourceFrom: 1 })).toBe(false)
    ponger.melds.push(specialKong('red', 'red'), specialKong('red', 'red'), specialKong('m7', 'joker'))
    expect(settlement.isLegalWin(0, { winTile: 'm4', sourceFrom: 1 })).toBe(true)
  })
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
