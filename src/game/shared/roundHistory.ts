import type { RoundResult, RoundScoreChange } from '../core/contracts/gamePort'

/** An immutable, publicly settled hand from the current online match. */
export interface MatchRoundRecord extends RoundResult {
  id: string
  round: number
  dealer: number
  honba: number
  /** Net change since the start of this hand, including intermediate transfers. */
  scoreChanges: RoundScoreChange[]
}
