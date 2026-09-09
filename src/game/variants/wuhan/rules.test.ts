import { describe, expect, it } from 'vitest'
import { evaluateWuhanWin, isWuhanStandardWin, withWuhanWinScenes, wuhanMeetsMinimum, wuhanRawWinPoints, wuhanWinPayment, WUHAN_RULESET } from './rules'

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
    expect(wuhanMeetsMinimum(['屁胡'], true, false, [])).toBe(false)
    expect(wuhanMeetsMinimum(['屁胡'], true, false, ['concealed'])).toBe(true)
    expect(wuhanRawWinPoints(['屁胡', '门前清'], true, false, [])).toBe(9)
    expect(wuhanMeetsMinimum(['屁胡', '门前清'], true, false, [])).toBe(true)
    expect(wuhanRawWinPoints(['清一色'], false, false, [], true)).toBe(12)
  })
  it('移除将一色、风一色和见字胡，门清牌加入门前清', () => {
    expect(evaluateWuhanWin(standard, { joker: 'white' })).toContain('门前清')
    expect(evaluateWuhanWin(standard, { joker: 'white' }).join(',')).not.toMatch(/将一色|风一色|见字胡/)
    const afterConcealedKong = ['m1','m2','m3','m4','m5','m6','p2','p3','p4','green','green'] as const
    expect(evaluateWuhanWin(afterConcealedKong, { exposed: 1, joker: 'white', menQianQing: true })).toContain('门前清')
  })
  it('点炮时三家付款且放炮者多付 2 分', () => {
    const players = Array.from({ length: 4 }, (_, seat) => ({
      name: String(seat), avatar: '', score: 1000, seat, hand: [], discards: [], melds: [], redCount: 0, drawnTileIndex: -1,
    }))
    expect(WUHAN_RULESET.score.applyWinScore(players, 0, 12, 2)).toBe(38)
    expect(players.map(player => player.score)).toEqual([1038, 988, 986, 988])
  })
})
