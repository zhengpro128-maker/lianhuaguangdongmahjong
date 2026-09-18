import { computed } from 'vue'
import { MATCH_NAMES } from '../../core/local/localGameConfig'
import { createCommonGameSelectors, createRulePlayerSelectors, structuralMeldCount } from '../../shared/selectors/gameSelectors'
import type { RuleSet } from '../../core/rules/ruleset'
import { WUHAN_RULESET, matchingCount } from './rules'
import { WUHAN_TILE_TYPES } from './ruleProfile'
import type { WuhanGameState } from './wuhanState'

export { structuralMeldCount }

export function createWuhanSelectors(
  state: WuhanGameState,
  ruleset: RuleSet = WUHAN_RULESET,
  canSelfDraw?: (playerIndex: number) => boolean,
) {
  const common = createCommonGameSelectors(state, MATCH_NAMES)
  const playerSelectors = createRulePlayerSelectors({
    players: state.players,
    user: common.user,
    phase: state.phase,
    isUserTurn: common.isUserTurn,
    userDrewThisTurn: state.userDrewThisTurn,
    selectedIndex: state.selectedIndex,
    availableWaitTiles: () => [...WUHAN_TILE_TYPES].filter((tile) => tile !== 'red'),
    isWinningHand: (hand, meldCount) => ruleset.win.isWinningHand(hand, meldCount, { jokers: state.jokerTiles.value }),
    // 红中和本局癞子没有“杠”按钮：直接打出便按单张杠处理并补摸。
    // 这里只保留暗杠/补杠等需要玩家主动选择的常规杠。
    concealedKongs: (hand) => ruleset.win.concealedKongs(hand, { jokers: state.jokerTiles.value }),
    waitingTiles: (hand, meldCount) => ruleset.win.waitingTiles(hand, meldCount, { jokers: state.jokerTiles.value }),
    matchingCount,
  })
  const userCanHu = computed(() => Boolean(common.user.value)
    && common.isUserTurn.value
    && state.userDrewThisTurn.value
    && (canSelfDraw?.(0) ?? playerSelectors.userCanHu.value))
  return { ...common, ...playerSelectors, userCanHu, userHasWindKong: computed(() => false) }
}
