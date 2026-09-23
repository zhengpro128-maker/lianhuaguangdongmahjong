import { describe, expect, it } from 'vitest'
import { advanceMatchState } from './matchProgress'

type AdvanceMatchInput = Parameters<typeof advanceMatchState>[0]

const base: Omit<AdvanceMatchInput, 'result'> = {
  round: 1,
  dealer: 0,
  honba: 0,
  matchType: 'east',
  scores: [1000, 1000, 1000, 1000],
}

describe('场次推进', () => {
  it('庄家和牌时连庄并增加本场', () => {
    expect(advanceMatchState({ ...base, result: { winnerIndex: 0 } })).toEqual({
      round: 1, dealer: 0, honba: 1, finished: false,
    })
  })

  it('闲家和牌时进入下一局并顺移庄位', () => {
    expect(advanceMatchState({ ...base, honba: 2, result: { winnerIndex: 2 } })).toEqual({
      round: 2, dealer: 1, honba: 0, finished: false,
    })
  })

  it('东四结束后结束东风场，半庄场则进入南一', () => {
    const eastFour = { ...base, round: 4, dealer: 3, result: { winnerIndex: 1 } }
    expect(advanceMatchState(eastFour)).toMatchObject({ round: 5, dealer: 0, finished: true })
    expect(advanceMatchState({ ...eastFour, matchType: 'hanchan' })).toMatchObject({ round: 5, dealer: 0, finished: false })
  })

  it('流局且庄家听牌 → 连庄（round/dealer 不变，honba+1）', () => {
    expect(advanceMatchState({ ...base, result: { draw: true, dealerTenpai: true } })).toEqual({
      round: 1, dealer: 0, honba: 1, finished: false,
    })
  })

  it('流局且庄家未听牌 → 下庄（庄位轮转）', () => {
    expect(advanceMatchState({ ...base, result: { draw: true, dealerTenpai: false } })).toEqual({
      round: 2, dealer: 1, honba: 0, finished: false,
    })
  })
})


it.each([['rounds4', 4], ['rounds8', 8], ['rounds16', 16]] as const)('%s counts every completed hand, including dealer repeats and draws', (matchType, rounds) => {
  for (const result of [{ winnerIndex: 0 }, { winnerIndex: 2 }, { draw: true, dealerTenpai: true }, { draw: true, dealerTenpai: false }]) {
    for (let round = 1; round <= rounds; round++) {
      const next = advanceMatchState({ ...base, matchType, round, result })
      expect(next.round).toBe(round + 1)
      expect(next.finished).toBe(round === rounds)
      expect(next.dealer).toBe(result.winnerIndex === 0 || result.dealerTenpai ? 0 : 1)
    }
  }
})
