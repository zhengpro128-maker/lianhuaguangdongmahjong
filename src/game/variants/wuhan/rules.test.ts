import { describe, expect, it } from 'vitest'
import { evaluateWuhanWin, isWuhanStandardWin, withWuhanWinScenes, wuhanWinPayment } from './rules'

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
})
