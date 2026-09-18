import { describe, expect, it } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { evaluateWuhanWin, isWuhanStandardWin, withWuhanWinScenes, wuhanMeetsMinimum, wuhanPatternPoints, wuhanRawWinPoints, wuhanWinPayment, WUHAN_RULESET } from './rules'

describe('武汉晃晃胡牌', () => {
  const standard = ['m1','m2','m3','m4','m5','m6','p2','p3','p4','s7','s8','s9','green','green'] as const
  it('rejects a red dragon retained in hand', () => expect(isWuhanStandardWin([...standard.slice(0, 13), 'red'], 0, 'white')).toBe(false))
  it('limits pihu to one joker but permits a big hand with more', () => {
    expect(evaluateWuhanWin([...standard.slice(0, 12), 'white', 'white'], { joker: 'white' })).not.toContain('屁胡')
    const peng = ['m1','m1','m1','p2','p2','p2','s3','s3','s3','green','green','green','white','white'] as const
    expect(evaluateWuhanWin(peng, { joker: 'white' })).toContain('碰碰胡')
  })
  it('adds only legal scene patterns and caps a payer', () => {
    expect(withWuhanWinScenes(['清一色'], ['m1'], { exposed: 4, discardWin: true, kongBloom: true })).toEqual(['清一色', '全求人', '杠上开花'])
    expect(wuhanWinPayment(['碰碰胡', '清一色'], true, true, ['concealed', 'added'])).toBe(50)
  })
  it('uses jokers to complete odd tiles before counting seven pairs', () => {
    const invalid = ['m1','m1','m2','m2','m3','m3','p1','p1','p2','p2','s1','s2','s3','white'] as const
    expect(evaluateWuhanWin(invalid, { joker: 'white' })).not.toContain('七对')
  })
  it('按新规则计算起胡、门前清、自摸和点炮', () => {
    expect(wuhanRawWinPoints(['屁胡'], true, false, [])).toBe(3)
    // 自摸由三家各付 3 分，总收 9 分；硬胡则每家 6 分、总收 18 分。
    expect(wuhanMeetsMinimum(['屁胡'], true, false, [])).toBe(true)
    expect(wuhanMeetsMinimum(['屁胡'], true, true, [])).toBe(true)
    expect(wuhanMeetsMinimum(['屁胡'], false, true, [])).toBe(false)
    expect(wuhanMeetsMinimum(['屁胡'], true, false, ['concealed'])).toBe(true)
    expect(wuhanRawWinPoints(['屁胡', '门前清'], true, false, [])).toBe(9)
    expect(wuhanMeetsMinimum(['屁胡', '门前清'], true, false, [])).toBe(true)
    expect(wuhanRawWinPoints(['清一色'], false, false, [], true)).toBe(10)
    expect(wuhanRawWinPoints(['七对'], true, false, ['red'])).toBe(30)
    expect(wuhanRawWinPoints(['龙七对'], true, false, ['red'])).toBe(60)
    expect(wuhanPatternPoints('双龙七对')).toBe(40)
    expect(wuhanRawWinPoints(['清一色', '门前清'], false, false, [])).toBe(20)
    expect(wuhanRawWinPoints(['清一色', '门前清'], true, false, [])).toBe(30)
  })
  it('移除将一色、风一色和见字胡，门清牌加入门前清', () => {
    expect(evaluateWuhanWin(standard, { joker: 'white', selfDraw: true })).toContain('门前清')
    expect(evaluateWuhanWin(standard, { joker: 'white' }).join(',')).not.toMatch(/将一色|风一色|见字胡/)
    const afterConcealedKong = ['m1','m2','m3','m4','m5','m6','p2','p3','p4','green','green'] as const
    expect(evaluateWuhanWin(afterConcealedKong, { exposed: 1, joker: 'white', menQianQing: true, selfDraw: true })).toContain('门前清')
  })
  it('清一色会把吃碰杠的副露牌一并检查', () => {
    const hand = ['m1','m1','m1','m2','m2','m2','m3','m3','m3','m4','m4'] as const
    expect(evaluateWuhanWin(hand, { exposed: 1, exposedTiles: ['m5', 'm6', 'm7'], joker: 'white' })).toContain('清一色')
    expect(evaluateWuhanWin(hand, { exposed: 1, exposedTiles: ['p5', 'p6', 'p7'], joker: 'white' })).not.toContain('清一色')
  })
  it('碰碰胡会把吃、碰、杠的副露结构一并检查', () => {
    const hand = ['m1','m1','m1','m2','m2','m2','p3','p3','p3','green','green'] as const
    const chi = { type: 'chi' as const, tile: 's5' as const, tiles: ['s5', 's6', 's7'] as TileType[] }
    const peng = { type: 'peng' as const, tile: 's5' as const, tiles: ['s5', 's5', 's5'] as TileType[] }

    expect(evaluateWuhanWin(hand, { exposed: 1, exposedMelds: [chi], joker: 'white' })).not.toContain('碰碰胡')
    expect(evaluateWuhanWin(hand, { exposed: 1, exposedMelds: [peng], joker: 'white' })).toContain('碰碰胡')
  })
  it('七对不与门前清叠加，其它大牌可以', () => {
    const sevenPairs = ['m1','m1','m2','m2','m3','m3','p1','p1','p2','p2','s1','s1','green','green'] as const
    expect(evaluateWuhanWin(sevenPairs, { joker: 'white', menQianQing: true })).toContain('七对')
    expect(evaluateWuhanWin(sevenPairs, { joker: 'white', menQianQing: true })).not.toContain('门前清')
  })
  it('点炮时三家付款且放炮者多付 2 分', () => {
    const players = Array.from({ length: 4 }, (_, seat) => ({
      name: String(seat), avatar: '', score: 1000, seat, hand: [], discards: [], melds: [], redCount: 0, drawnTileIndex: -1,
    }))
    expect(WUHAN_RULESET.score.applyWinScore(players, 0, 12, 2)).toBe(48)
    expect(players.map(player => player.score)).toEqual([1048, 988, 976, 988])
  })
})
