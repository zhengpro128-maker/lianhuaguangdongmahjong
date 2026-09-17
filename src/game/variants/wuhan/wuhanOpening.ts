import type { MatchType, TileType } from '../../core/contracts/types'
import { MATCH_HANDS } from '../../core/local/localGameConfig'
import { sortTilesWithJokers, tileName } from '../../core/rules/tiles'
import { dealInitialHands, resetLocalPlayers, type PlayerSeed } from '../../shared/runtime/localOpening'
import type { RuleSet } from '../../core/rules/ruleset'
import { createWuhanWall, wuhanJokerForIndicator } from './ruleProfile'
import { WUHAN_RULESET } from './rules'
import type { WuhanEndGameOptions, WuhanGameState } from './wuhanState'

interface Options {
  state: WuhanGameState
  clearTimers(): void
  takeTile(fromTail?: boolean): TileType | null
  wait(delay: number): Promise<void>
  later(callback: () => void, delay: number): number
  playSound(name: string, volume?: number): unknown
  playSoundAndWait(name: string, volume?: number): Promise<void>
  announce(text: string, tone?: string): void
  getRoundLabel(): string
  beginTurn(playerIndex: number, options?: { skipDraw?: boolean; fromTail?: boolean; preDrawn?: boolean }): unknown
  endGame(winnerIndex: number, options?: WuhanEndGameOptions): unknown
  isLegalWin(winnerIndex: number, options: WuhanEndGameOptions): boolean
  ruleset?: RuleSet
  playerSeeds?: Array<PlayerSeed | undefined>
  humanPlayerSeed?: PlayerSeed
}

export function createWuhanOpening(options: Options) {
  const { state } = options
  const ruleset = options.ruleset ?? WUHAN_RULESET
  let sequence = 0

  function cancel() {
    sequence += 1
    state.openingStage.value = null
  }

  function resetPlayers() {
    resetLocalPlayers(state, 1000, options.playerSeeds as PlayerSeed[] | undefined, options.humanPlayerSeed)
  }

  async function start(mode?: MatchType, startOptions: {
    waitForTableReady?: () => Promise<void>
    waitForOpeningReady?: () => Promise<void>
    initialWall?: TileType[]
    openingDice?: [number, number]
  } = {}) {
    options.clearTimers()
    if (mode && MATCH_HANDS[mode]) {
      state.matchType.value = mode
      state.round.value = 1
      state.dealer.value = 0
      state.honba.value = 0
      state.matchFinished.value = false
      state.players.splice(0, state.players.length)
    }
    const currentSequence = sequence
    resetPlayers()
    state.wall.value = startOptions.initialWall ? [...startOptions.initialWall] : createWuhanWall()
    state.wallHeadDrawn.value = 0
    state.result.value = null
    state.winEffect.value = null
    state.winPresentation.value = null
    state.revealHands.value = false
    state.winningPlayerIndex.value = -1
    state.actionPrompt.value = null
    state.pendingKong.value = null
    state.userDrewThisTurn.value = false
    state.selectedIndex.value = -1
    state.lastDiscard.value = null
    state.lastDiscardSound.value = null
    state.phase.value = 'dealing'
    state.dealAnimation.value = { playerIndex: -1, count: 0, serial: 0 }
    state.diceThrowerIndex.value = state.dealer.value
    state.flipTile.value = null
    state.jokerTiles.value = []
    state.wildcardTiles.value = []
    state.flipStack.value = null
    state.firstDice.value = null
    state.secondDice.value = null
    state.wallBreakIndex.value = 0
    state.roundFirstDiscard.value = true

    if (startOptions.waitForTableReady) {
      await startOptions.waitForTableReady()
      if (currentSequence !== sequence) return
    }
    state.openingStage.value = 'start'
    await Promise.all([options.playSoundAndWait('game_start.mp3'), options.wait(1250)])
    if (currentSequence !== sequence) return

    const dice: [number, number] = startOptions.openingDice
      ? [...startOptions.openingDice]
      : [roll(), roll()]
    state.diceValues.value = dice
    state.firstDice.value = dice
    state.openingStage.value = 'dice'
    await Promise.all([options.playSoundAndWait('dice.mp3'), options.wait(1150)])
    if (currentSequence !== sequence) return

    const indicatorIndex = ((dice[0] + dice[1] - 2) * 2 + 1) % state.wall.value.length
    const indicator = state.wall.value[indicatorIndex]
    const joker = wuhanJokerForIndicator(indicator)
    state.flipStack.value = Math.floor(indicatorIndex / 2)
    state.flipTile.value = indicator
    state.jokerTiles.value = [joker]
    state.openingStage.value = 'flip'
    options.announce(`翻癞子 ${tileName(indicator)}，${tileName(joker)}为癞子`)
    await options.wait(1100)
    if (currentSequence !== sequence) return

    state.openingStage.value = 'deal'
    const dealt = await dealInitialHands({
      state,
      takeTile: options.takeTile,
      wait: options.wait,
      playSound: options.playSound,
      sortHand: (hand) => sortTilesWithJokers(hand, state.jokerTiles.value),
      isCancelled: () => currentSequence !== sequence,
    })
    if (!dealt) return

    state.phase.value = 'opening'
    state.openingStage.value = null
    state.dealAnimation.value = { playerIndex: -1, count: 0, serial: state.dealAnimation.value.serial + 1 }
    options.announce(`${options.getRoundLabel()} · 武汉晃晃开牌`)
    const dealer = state.players[state.dealer.value]
    const openingWin = { selfDraw: true, winHand: [...dealer.hand] }
    if (options.isLegalWin(state.dealer.value, openingWin)) {
      return options.endGame(state.dealer.value, openingWin)
    }
    if (startOptions.waitForOpeningReady) {
      await startOptions.waitForOpeningReady()
      if (currentSequence !== sequence) return
    }
    options.later(() => options.beginTurn(state.dealer.value, { skipDraw: true, preDrawn: true }), 650)
  }

  const roll = () => Math.floor(Math.random() * 6) + 1
  return { start, cancel, resetPlayers }
}
