import type { TileType } from '../../core/contracts/types'
import { createWuhanWall, WUHAN_DRAW_STOP_COUNT, wuhanJokerForIndicator } from './ruleProfile'

export interface WuhanRoundWall {
  /** 发牌和正常摸牌从头取；杠后补牌从尾取。翻出的指示牌仍保留在物理牌墙中。 */
  wall: TileType[]
  indicatorIndex: number
  indicator: TileType
  joker: TileType
  headDrawn: number
}

/** 以两骰之和定位翻牌；120 张牌按双层 60 墩处理。 */
export function createWuhanRoundWall(dice: readonly [number, number], random: () => number = Math.random): WuhanRoundWall {
  const wall = createWuhanWall(random)
  const indicatorIndex = ((dice[0] + dice[1] - 2) * 2 + 1) % wall.length
  const indicator = wall[indicatorIndex]
  return { wall, indicatorIndex, indicator, joker: wuhanJokerForIndicator(indicator), headDrawn: 0 }
}

export function canWuhanDraw(round: WuhanRoundWall): boolean {
  return round.wall.length - round.headDrawn > WUHAN_DRAW_STOP_COUNT
}

export function drawWuhanHead(round: WuhanRoundWall): TileType | null {
  if (!canWuhanDraw(round)) return null
  const tile = round.wall[round.headDrawn] ?? null
  if (tile) round.headDrawn += 1
  return tile
}

export function drawWuhanTail(round: WuhanRoundWall): TileType | null {
  if (!canWuhanDraw(round)) return null
  return round.wall.pop() ?? null
}

/** 红中不混入通常面子；单张单杠并在记录中保留原牌。 */
export function declareWuhanRedKong(hand: TileType[]): boolean {
  const index = hand.indexOf('red')
  if (index < 0) return false
  hand.splice(index, 1)
  return true
}
