import type { TileType } from '../../core/contracts/types'
import { startWuhanRound, type WuhanRoundState } from './gameState'
import { canDiscardWuhanTile, drawWuhanTurn, performWuhanRedKong } from './turn'
import { findWuhanClaims } from './claims'

export type WuhanPhase = 'draw' | 'discard' | 'claim' | 'settled'
export class WuhanEngine {
  readonly state: WuhanRoundState
  phase: WuhanPhase = 'discard'
  current: number
  lastDiscard: { seat: number; tile: TileType } | null = null
  constructor(dealer = 0, dice: readonly [number, number] = [1, 1], random?: () => number) {
    this.state = startWuhanRound(dealer, dice, random)
    this.current = dealer
  }
  draw() { const result = drawWuhanTurn(this.state, this.current); this.phase = result.kind === 'draw' ? 'settled' : 'discard'; return result }
  redKong() { const result = performWuhanRedKong(this.state, this.current); this.phase = result.kind === 'draw' ? 'settled' : 'discard'; return result }
  discard(index: number) {
    const hand = this.state.hands[this.current]; const tile = hand[index]
    if (!tile || !canDiscardWuhanTile(tile)) throw new Error('该牌不可打出')
    hand.splice(index, 1); this.lastDiscard = { seat: this.current, tile }; this.phase = 'claim'
    return { tile, claims: findWuhanClaims(this.state.hands, this.current, tile) }
  }
  passClaims() { if (!this.lastDiscard) return; this.current = (this.lastDiscard.seat + 1) % 4; this.lastDiscard = null; this.phase = 'draw' }
}
