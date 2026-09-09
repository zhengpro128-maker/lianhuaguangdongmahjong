import { describe, expect, it } from 'vitest'
import { findWuhanClaims, wuhanChiOptions } from './claims'
describe('武汉晃晃弃牌响应', () => {
  it('allows only next seat to chi and prioritizes gang then peng then chi', () => {
    const hands = [['m1'], ['m2','m3','m4','m6','m5','m5'], ['m5','m5','m5'], ['m5','m5']] as any
    expect(wuhanChiOptions(hands[1], 'm1')).toEqual([['m1','m2','m3']])
    expect(findWuhanClaims(hands, 0, 'm5').map(item => item.kind)).toEqual(['gang','peng','peng','chi','chi'])
  })
  it('does not allow a red dragon claim', () => expect(findWuhanClaims([[], ['red','red','red'], [], []], 0, 'red')).toEqual([]))
})
