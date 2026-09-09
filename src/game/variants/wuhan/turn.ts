import type { TileType } from '../../core/contracts/types'
import { declareWuhanRedKong, drawWuhanHead, drawWuhanTail } from './roundFlow'
import type { WuhanRoundState } from './gameState'

export type WuhanTurnResult = { kind: 'tile'; tile: TileType } | { kind: 'draw' }

export function drawWuhanTurn(state: WuhanRoundState, seat: number): WuhanTurnResult {
  const tile = drawWuhanHead(state)
  if (!tile) { state.draw = true; return { kind: 'draw' } }
  state.hands[seat].push(tile)
  return { kind: 'tile', tile }
}

/** 红中不可打出；玩家主动宣告后以一张红中换一张牌尾补牌。 */
export function performWuhanRedKong(state: WuhanRoundState, seat: number): WuhanTurnResult {
  const hand = state.hands[seat]
  if (!declareWuhanRedKong(hand)) throw new Error('手中没有可杠的红中')
  state.redKongs[seat] += 1
  const tile = drawWuhanTail(state)
  if (!tile) { state.draw = true; return { kind: 'draw' } }
  state.tailDrawn += 1
  hand.push(tile)
  return { kind: 'tile', tile }
}

export function canDiscardWuhanTile(tile: TileType): boolean {
  return tile !== 'red'
}
