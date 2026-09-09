// 武汉晃晃本地引擎组装：把规则、开局、回合、杠和结算接入统一 GamePort。
import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import type { TableActionEvent, TileType } from '../../core/contracts/types'
import { defineGamePort } from '../../core/contracts/gamePort'
import { createLocalCountdownController } from '../../core/local/localCountdownController'
import { createLocalTransientEventPresenter } from '../../core/local/localTransientEventPresenter'
import { createMatchLifecycle } from '../../shared/runtime/matchLifecycle'
import { createTimerScheduler } from '../../shared/runtime/timerScheduler'
import type { PlayerSeed } from '../../shared/runtime/localOpening'
import { resolveAnimeAudioPolicy } from '../../core/presentation/animeAudioPolicy'
import {
  ANIME_ACTION_FALLBACK_AUDIO,
  type AnimeFixedTtsExecutor,
  type AnimeSeat,
} from '../../llm/animeFixedTtsExecutor'

const ANIME_FIXED_ACTION_AUDIO_FILES: ReadonlySet<string> = new Set(
  Object.values(ANIME_ACTION_FALLBACK_AUDIO),
)
import { tileName } from '../../core/rules/tiles'
import type { LotusController as WuhanController, LotusHumanBridge as WuhanHumanBridge } from '../lotus/lotusControllers'
import { LotusAiController as WuhanAiController, LotusHumanController as WuhanHumanController } from '../lotus/lotusControllers'
import { createWuhanHuman } from './wuhanHuman'
import { createLotusKong as createWuhanKong } from '../lotus/lotusKong'
import { sortTilesWithJokers } from '../../core/rules/tiles'
import { createWuhanOpening } from './wuhanOpening'
import { createWuhanSelectors, structuralMeldCount } from './wuhanSelectors'
import { createWuhanSettlement } from './wuhanSettlement'
import { createWuhanGameState, type WuhanEndGameOptions } from './wuhanState'
import { createWuhanTileFlow } from './wuhanTileFlow'
import { createWuhanTurnOrchestrator } from './wuhanTurnOrchestrator'
import { WUHAN_RULESET } from './rules'
import type { RuleSet } from '../../core/rules/ruleset'

interface UseWuhanGameOptions {
  playSound?: (name: string, volume?: number, onFinish?: () => void) => unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  controllers?: WuhanController[]
  /** 单机人机：注入座位 1-3 的 AI 控制器（可含 LLM 控制器）；默认启发式 AI 玩家 */
  aiControllers?: WuhanController[]
  /** 单机人机：座位 1-3 的玩家形象（昵称/头像，LLM 人设覆盖） */
  aiPlayerSeeds?: Array<PlayerSeed | undefined>
  /** 单机本家座位 0 的展示形象。 */
  humanPlayerSeed?: PlayerSeed
  /** 由表现层动态读取；规则引擎不得直接访问 DOM 或 URL。 */
  getThemeName?: () => string
  animeFixedTts?: AnimeFixedTtsExecutor
  countdownEnabled?: boolean
  ruleset?: RuleSet
}

export function useWuhanGame({
  playSound = () => {},
  playSoundAndWait = async () => {},
  controllers: suppliedControllers,
  aiControllers,
  aiPlayerSeeds,
  humanPlayerSeed,
  getThemeName = () => 'jade',
  animeFixedTts,
  countdownEnabled = true,
  ruleset = WUHAN_RULESET,
}: UseWuhanGameOptions = {}) {
  const state = createWuhanGameState()
  const selectors = createWuhanSelectors(state, ruleset)

  let openingTimeline!: ReturnType<typeof createWuhanOpening>
  let settlementTimeline!: ReturnType<typeof createWuhanSettlement>
  let kong!: ReturnType<typeof createWuhanKong>
  let turnOrchestrator!: ReturnType<typeof createWuhanTurnOrchestrator>
  let tileFlowExecutor!: ReturnType<typeof createWuhanTileFlow>
  let playerActions!: ReturnType<typeof createWuhanHuman>
  let countdown!: ReturnType<typeof createLocalCountdownController>
  let transient!: ReturnType<typeof createLocalTransientEventPresenter>

  const usesAnimeFixedActionVoice = () => resolveAnimeAudioPolicy({
    themeName: getThemeName(),
    playerKind: 'unknown',
  }).actionVoice === 'fixed-line'
  const playPresentationSound = (name: string, volume?: number, onFinish?: () => void) => {
    if (usesAnimeFixedActionVoice() && ANIME_FIXED_ACTION_AUDIO_FILES.has(name)) return
    if (onFinish !== undefined) return playSound(name, volume, onFinish)
    if (volume !== undefined) return playSound(name, volume)
    return playSound(name)
  }
  const playPresentationSoundAndWait = (name: string, volume?: number) => (
    usesAnimeFixedActionVoice() && ANIME_FIXED_ACTION_AUDIO_FILES.has(name)
      ? Promise.resolve()
      : playSoundAndWait(name, volume)
  )
  const playAnimeAction = (event: TableActionEvent) => {
    if (!animeFixedTts || !usesAnimeFixedActionVoice()) return
    const actor = state.players[event.actorIndex]
    if (!actor || event.actorIndex < 0 || event.actorIndex > 3) return
    void animeFixedTts.executeAction({
      eventId: event.id,
      seat: event.actorIndex as AnimeSeat,
      characterId: actor.characterId,
      action: event.type,
    }).then((result) => {
      if (result.fallbackAudioFile) playSound(result.fallbackAudioFile)
    }).catch(() => {})
  }

  const humanBridge: WuhanHumanBridge = {
    isTurn: ref(false),
    canHu: ref(false),
    canKong: ref<TileType[]>([]),
    canWindKong: ref(false),
    actionPrompt: state.actionPrompt,
    selectedIndex: state.selectedIndex,
    drawnThisTurn: state.userDrewThisTurn,
    turnSeconds: state.turnSeconds,
    activateTurn() {
      state.phase.value = 'discard'
      countdown.startTurn()
    },
    activateHu() {
      state.phase.value = 'prompt'
      countdown.startPrompt()
    },
    activateClaim() {
      state.phase.value = 'prompt'
      countdown.startPrompt()
    },
    activateChi() {
      state.phase.value = 'prompt'
      countdown.startPrompt()
    },
    activateRobKong() {
      state.phase.value = 'prompt'
      transient.announce('可抢杠胡', 'red')
      countdown.startPrompt()
    },
    deactivate() {
      countdown?.stop()
    },
  }
  const humanController = new WuhanHumanController(humanBridge)
  const controllers: WuhanController[] = suppliedControllers ?? [
    humanController,
    ...(aiControllers && aiControllers.length ? aiControllers : [new WuhanAiController(), new WuhanAiController(), new WuhanAiController()]),
  ]

  // 设置页只在大厅开放；保存后替换内部数组，使下一次开局读取新的 AI 控制器。
  // 调用方不能直接替换 aiControllers 参数，因为下游编排器持有的是这个数组的引用。
  function replaceAiControllers(nextControllers?: WuhanController[] | null) {
    const replacement = nextControllers && nextControllers.length
      ? nextControllers
      : [new WuhanAiController(), new WuhanAiController(), new WuhanAiController()]
    controllers.splice(1, Math.max(0, controllers.length - 1), ...replacement)
  }

  const timer = createTimerScheduler({
    controllers,
    stopCountdown: () => countdown?.stop(),
    cancelOpening: () => openingTimeline?.cancel(),
  })
  const clearPresentation = () => {
    timer.clear()
    animeFixedTts?.cancel()
  }
  transient = createLocalTransientEventPresenter({
    state,
    later: timer.later,
    onTableAction: playAnimeAction,
  })

  function endGame(winnerIndex: number, options: WuhanEndGameOptions = {}) {
    return settlementTimeline.endGame(winnerIndex, options)
  }

  function endDraw() {
    return settlementTimeline.endDraw()
  }

  function beginTurn(playerIndex: number, options: { skipDraw?: boolean; fromTail?: boolean } = {}) {
    return turnOrchestrator.beginTurn(playerIndex, options)
  }

  settlementTimeline = createWuhanSettlement({
    state,
    clearTimers: clearPresentation,
    later: timer.later,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    showTableAction: transient.showTableAction,
    structuralMeldCount: (playerIndex) => structuralMeldCount(state.players[playerIndex]),
    getRoundLabel: () => selectors.roundLabel.value,
    ruleset,
    getThemeName,
    animeFixedTts,
  })

  countdown = createLocalCountdownController({
    state,
    playSound: playPresentationSound,
    enabled: countdownEnabled,
    onDiscard: () => playerActions.userDiscard(),
    onPass: () => playerActions.userPass(),
  })

  tileFlowExecutor = createWuhanTileFlow({
    state,
    controllers,
    getTurnOrchestrator: () => turnOrchestrator,
    endDraw,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    shouldAnnounceDiscard: (_playerIndex, player) => (
      resolveAnimeAudioPolicy({
        themeName: getThemeName(),
        playerKind: player.playerKind,
        isLlm: player.isLlm,
      }).discard.tileName !== 'suppress'
    ),
    later: timer.later,
    stopCountdown: countdown.stop,
  })

  openingTimeline = createWuhanOpening({
    state,
    clearTimers: clearPresentation,
    takeTile: tileFlowExecutor.takeTile,
    wait: timer.wait,
    later: timer.later,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    announce: transient.announce,
    getRoundLabel: () => selectors.roundLabel.value,
    beginTurn,
    ruleset,
    endGame,
    playerSeeds: aiPlayerSeeds,
    humanPlayerSeed,
  })
  const startGame = (mode?: Parameters<typeof openingTimeline.start>[0]) => {
    animeFixedTts?.reset()
    return openingTimeline.start(mode)
  }

  const tableContext = {
    players: state.players,
    currentPlayer: state.currentPlayer,
    sortHand: (hand) => sortTilesWithJokers(hand, state.jokerTiles.value),
    showTableAction: transient.showTableAction,
    showScoreFlow: transient.showScoreFlow,
    playSound: playPresentationSound,
    scoreDiscardGang: (players, playerIndex, fromIndex) => ruleset.score.applyKongScore(players, playerIndex, 'discard', fromIndex),
  }

  kong = createWuhanKong({
    state,
    showTableAction: transient.showTableAction,
    showScoreFlow: transient.showScoreFlow,
    playSound: playPresentationSound,
    later: timer.later,
    ruleset,
    beginTurn,
  })
  turnOrchestrator = createWuhanTurnOrchestrator({
    state,
    controllers,
    tableContext,
    structuralMeldCount: (playerIndex) => structuralMeldCount(state.players[playerIndex]),
    drawFor: tileFlowExecutor.drawFor,
    performConcealedKong: kong.performConcealedKong,
    declareAddedKong: kong.declareAddedKong,
    settleAddedKong: kong.settleAddedKong,
    discardTile: tileFlowExecutor.discardTile,
    endDraw,
    endGame,
    announce: transient.announce,
    later: timer.later,
    ruleset,
  })

  playerActions = createWuhanHuman({
    state,
    humanController,
    tableContext,
    turnOrchestrator,
    kong,
    getUser: () => selectors.user.value,
    isUserTurn: () => selectors.isUserTurn.value,
    canUserHu: () => selectors.userCanHu.value,
    getUserKongs: () => selectors.userKongs.value,
    userHasWindKong: () => false,
    stopCountdown: countdown.stop,
    startTurnCountdown: countdown.startTurn,
    discardTile: tileFlowExecutor.discardTile,
    beginTurn: (playerIndex, options) => beginTurn(playerIndex, options),
    endGame,
    announce: transient.announce,
    playSound: playPresentationSound,
    later: timer.later,
  })

  const matchLifecycle = createMatchLifecycle({ state, clearTimers: clearPresentation, startGame })
  const capabilities = computed(() => ({
    chi: { choose: playerActions.userChi },
    lotusTable: {
      flipTile: state.flipTile.value,
      jokerTiles: state.jokerTiles.value,
      wildcardTiles: state.wildcardTiles.value,
      wallBreakIndex: state.wallBreakIndex.value,
      flipStack: state.flipStack.value,
    },
  }))

  // 模拟测试里没有组件实例，直接注册会触发 Vue 警告；与 useRemoteGame.ts 同款守卫。
  if (getCurrentInstance()) onBeforeUnmount(clearPresentation)

  return defineGamePort({
    phase: state.phase,
    players: state.players,
    wall: state.wall,
    wallHeadDrawn: state.wallHeadDrawn,
    wallCount: selectors.wallCount,
    currentPlayer: state.currentPlayer,
    selectedIndex: state.selectedIndex,
    turnSeconds: state.turnSeconds,
    lastDiscard: state.lastDiscard,
    actionPrompt: state.actionPrompt,
    announcement: state.announcement,
    tableActionEvent: state.tableActionEvent,
    scoreFlowEvent: state.scoreFlowEvent,
    result: state.result,
    winEffect: state.winEffect,
    winPresentation: state.winPresentation,
    revealHands: state.revealHands,
    winningPlayerIndex: state.winningPlayerIndex,
    round: state.round,
    dealer: state.dealer,
    user: selectors.user,
    isUserTurn: selectors.isUserTurn,
    userCanHu: selectors.userCanHu,
    matchType: state.matchType,
    matchName: selectors.matchName,
    matchFinished: state.matchFinished,
    honba: state.honba,
    roundLabel: selectors.roundLabel,
    standings: selectors.standings,
    dealAnimation: state.dealAnimation,
    openingStage: state.openingStage,
    diceValues: state.diceValues,
    diceThrowerIndex: state.diceThrowerIndex,
    secondDice: state.secondDice,
    userCurrentWaits: selectors.userCurrentWaits,
    userTingOptions: selectors.userTingOptions,
    userDiscardWaits: selectors.userDiscardWaits,
    userKongs: selectors.userKongs,
    capabilities,
    // 动态癞子与翻牌的共享牌桌能力。
    flipTile: state.flipTile,
    jokerTiles: state.jokerTiles,
    wildcardTiles: state.wildcardTiles,
    wallBreakIndex: state.wallBreakIndex,
    flipStack: state.flipStack,
    startGame,
    ...playerActions,
    ...matchLifecycle,
    tileName,
    humanController,
    replaceAiControllers,
  })
}

export type WuhanGame = ReturnType<typeof useWuhanGame>
