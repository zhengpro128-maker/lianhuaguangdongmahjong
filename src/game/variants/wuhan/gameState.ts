import type { TileType } from '../../core/contracts/types'
import { sortTilesWithJokers } from '../../core/rules/tiles'
import { createWuhanRoundWall, drawWuhanHead, type WuhanRoundWall } from './roundFlow'

export interface WuhanRoundState extends WuhanRoundWall {
  dealer: number
  hands: TileType[][]
  /** 红中单杠以单张副露记录；不再进入手牌或胡牌计算。 */
  redKongs: number[]
  tailDrawn: number
  draw: boolean
}

export function startWuhanRound(dealer: number, dice: readonly [number, number], random: () => number = Math.random): WuhanRoundState {
  const round = createWuhanRoundWall(dice, random)
  const hands = Array.from({ length: 4 }, () => [] as TileType[])
  for (let seat = 0; seat < 4; seat += 1) {
    const amount = seat === dealer ? 14 : 13
    for (let index = 0; index < amount; index += 1) {
      const tile = drawWuhanHead(round)
      if (!tile) throw new Error('武汉晃晃牌墙不足以完成起手发牌')
      hands[seat].push(tile)
    }
    hands[seat] = sortTilesWithJokers(hands[seat], [round.joker])
  }
  return { ...round, dealer, hands, redKongs: [0, 0, 0, 0], tailDrawn: 0, draw: false }
}
