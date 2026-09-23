import { effectScope, isRef, watchEffect, type EffectScope } from 'vue'
import { GAME_PORT_STATE_KEYS, type GamePort } from '../../src/game/core/contracts/gamePort'
import type { MatchType, TileType } from '../../src/game/core/contracts/types'
import { tileFaceFile, tileName } from '../../src/game/core/rules/tiles'
import { useWuhanGame } from '../../src/game/variants/wuhan/useWuhanGame'
import { WUHAN_RULESET } from '../../src/game/variants/wuhan/rules'
import { chooseFallbackDiscardIndex, decideClaim, decideTurn } from '../../src/game/variants/lotus/lotusAi'
import { createRemoteSessionStore } from '../../src/game/online/session/remoteSessionStore'
import { useRemoteGame } from '../../src/game/online/useRemoteGame'
import { installMiniGamePlatform } from './platform'

export const MINI_RULE_VARIANT = 'wuhan-huanghuang' as const
export interface MiniAction {
  id: string
  type: 'hu' | 'peng' | 'gang' | 'chi' | 'pass' | 'discard'
  label: string
  tile?: TileType
  tiles?: TileType[]
  optionIndex?: number
}
type Value<T> = T extends { value: infer V } ? V : T
type PortState = { [K in typeof GAME_PORT_STATE_KEYS[number]]: Value<GamePort[K]> }
export type MiniGameSnapshot = PortState & {
  ruleVariant: typeof MINI_RULE_VARIANT
  rulesetId: typeof MINI_RULE_VARIANT
  gameMode: 'local' | 'online'
  canResume: boolean
  online: { roomId: string; seats: unknown[]; isCreator: boolean; mySeat: number; error: string; status: string } | null
  autoPlay: boolean
  paused: boolean
  countdownEnabled: boolean
  actions: MiniAction[]
  jokerTiles: TileType[]
  wildcardTiles: TileType[]
  flipTile: TileType | null
  flipStack: number | null
  wallBreakIndex: number
  secondDice: number[]
  dealerIndex: number
  winnerIndex: number
  wallTotal: number
  jokerAsLaizi: boolean
}
interface MiniGameOptions {
  onChange?: (state: MiniGameSnapshot) => void
  onError?: (error: unknown) => void
  playSound?: (name: string, volume?: number, onFinish?: () => void) => unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  waitForTableReady?: () => Promise<unknown>
  getThemeName?: () => string
  countdownEnabled?: boolean
}

/** Plain snapshots never leak Vue proxies or callable capabilities into the renderer. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item !== 'function').map(([key, item]) => [key, copy(item)]),
  ) as T
  return value
}

export function tileAssetPath(tile: TileType): string | null {
  const file = tileFaceFile(tile)
  return file ? `assets/tiles/${file}` : null
}

/** The mini game uses the actual browser Wuhan engine, including AI, scoring and match progression. */
export function createMiniGame(options: MiniGameOptions = {}) {
  installMiniGamePlatform()
  let port: ReturnType<typeof useWuhanGame> | ReturnType<typeof useRemoteGame>
  const remote = () => port as ReturnType<typeof useRemoteGame>
  let online = false
  let identity = { nickname: '微信玩家', avatarUrl: '' }
  let scope: EffectScope | null = null
  let disposed = false, paused = false, autoPlay = false, generation = 0
  let autoTimer: ReturnType<typeof setTimeout> | null = null
  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let decisionKey = '', submittedKey = '', seconds = 0
  let cancelStart: (() => void) | null = null

  function disconnected() { return online && remote().wsStatus.value !== 'connected' }
  function actions(): MiniAction[] {
    if (!port || paused || disposed || disconnected()) return []
    const prompt = port.actionPrompt.value
    const result: MiniAction[] = []
    if (port.phase.value === 'prompt' && prompt) {
      if (prompt.canHu || prompt.type === 'hu' || prompt.type === 'rob') result.push({ id: 'hu', type: 'hu', label: '胡' })
      if (prompt.canPeng) result.push({ id: 'peng', type: 'peng', label: '碰', tile: prompt.tile })
      if (prompt.canGang) result.push({ id: 'gang-discard', type: 'gang', label: '杠', tile: prompt.tile })
      prompt.chiOptions?.forEach((option, index) => result.push({
        id: `chi:${index}`, type: 'chi', label: '吃', tiles: [...option.tiles], optionIndex: index,
      }))
      result.push({ id: 'pass', type: 'pass', label: '过' })
    } else if (port.isUserTurn.value) {
      if (port.userCanHu.value) result.push({ id: 'hu', type: 'hu', label: '胡' })
      for (const tile of port.userKongs.value) result.push({ id: `gang:${tile}`, type: 'gang', label: '杠', tile })
      result.push({ id: 'discard', type: 'discard', label: '出牌' })
    }
    return result
  }

  function snapshot(): MiniGameSnapshot {
    const state = Object.fromEntries(GAME_PORT_STATE_KEYS.map((key) => {
      const value = port[key]
      return [key, copy(isRef(value) ? value.value : value)]
    })) as PortState
    if (online) {
      state.players = state.players.map((player, seat) => ({ ...player, seat,
        avatar: player.avatar?.startsWith('https://') ? player.avatar : `assets/avatars/${['lotus', 'ah-lok', 'shisan', 'young-master'][seat]}.png` }))
      state.user = state.players[0]
    }
    const table = port.capabilities.value.lotusTable
    return { ...state, ruleVariant: MINI_RULE_VARIANT, rulesetId: MINI_RULE_VARIANT, gameMode: online ? 'online' : 'local',
      canResume: !!createRemoteSessionStore().loadSession(),
      online: online ? { roomId: remote().roomId.value, seats: copy(remote().roomSeats.value), isCreator: remote().isCreator.value,
        mySeat: remote().mySeat.value, error: remote().sessionError.value, status: remote().wsStatus.value } : null,
      autoPlay: online ? remote().autoPlay.value : autoPlay, paused, countdownEnabled: options.countdownEnabled === true,
      turnSeconds: online ? port.turnSeconds.value : options.countdownEnabled ? seconds : 0,
      actions: actions(), jokerTiles: [...(table?.jokerTiles ?? [])], wildcardTiles: [...(table?.wildcardTiles ?? [])],
      flipTile: table?.flipTile ?? null, flipStack: table?.flipStack ?? null,
      wallBreakIndex: table?.wallBreakIndex ?? 0, secondDice: [...(port.secondDice.value ?? [])],
      dealerIndex: state.dealer, winnerIndex: state.winningPlayerIndex, wallTotal: 120, jokerAsLaizi: true,
    }
  }

  function emit() { if (!disposed) options.onChange?.(snapshot()) }
  function clearAutoTimer() { if (autoTimer !== null) clearTimeout(autoTimer); autoTimer = null }
  function clearCountdown() { if (countdownTimer !== null) clearInterval(countdownTimer); countdownTimer = null }
  function decisionIdentity() {
    if (!port.isUserTurn.value && !port.actionPrompt.value) return ''
    return JSON.stringify([port.phase.value, port.currentPlayer.value, port.user.value?.hand,
      port.user.value?.melds, port.actionPrompt.value, port.lastDiscard.value?.id, port.wallCount.value])
  }

  function autoDecision() {
    if (disposed || paused) return false
    const offered = actions(), user = port.user.value
    if (!user || !offered.length) return false
    if (offered.some(item => item.id === 'hu')) return action('hu')
    const publicTiles = port.players.flatMap(player => [...player.discards, ...player.melds.flatMap(meld => meld.tiles)])
    const view = { hand: [...user.hand], melds: copy(user.melds), exposedMelds: user.melds.filter(meld => meld.type !== 'flower').length,
      jokers: [...port.jokerTiles.value], visibleTiles: [...user.hand, ...publicTiles], publicTiles,
      upperLastDiscard: port.players[3]?.discards.at(-1), earlyRound: port.players.every(player => player.discards.length < 5),
      wallCount: port.wallCount.value, ruleset: WUHAN_RULESET }
    const prompt = port.actionPrompt.value
    if (prompt) {
      const choice = decideClaim({ ...view, tile: prompt.tile, from: prompt.from, canGang: !!prompt.canGang,
        canPeng: !!prompt.canPeng, chiOptions: prompt.chiOptions ?? [] })
      if (choice.kind === 'gang') return action('gang-discard')
      if (choice.kind === 'peng') return action('peng')
      if (choice.kind === 'chi') {
        const index = prompt.chiOptions?.findIndex(option => option.tiles.join(',') === choice.meld.tiles.join(',')) ?? -1
        if (index >= 0) return action(`chi:${index}`)
      }
      return action('pass')
    }
    if (!port.isUserTurn.value) return false
    const redIndex = user.hand.indexOf('red')
    if (redIndex >= 0) return discard(redIndex)
    const choice = decideTurn({ ...view, kongBloom: false })
    if (choice.kind === 'concealed-kong' && offered.some(item => item.id === `gang:${choice.tile}`)) return action(`gang:${choice.tile}`)
    if (choice.kind === 'added-kong') {
      const id = `gang:${user.melds[choice.meldIndex]?.tile}`
      if (offered.some(item => item.id === id)) return action(id)
    }
    return discard(choice.kind === 'discard' ? choice.handIndex : chooseFallbackDiscardIndex(user.hand, view.jokers))
  }

  function syncTimers() {
    if (online) return
    const nextKey = decisionIdentity()
    if (decisionKey !== nextKey) {
      decisionKey = nextKey; submittedKey = ''; seconds = nextKey ? 12 : 0
      clearAutoTimer(); clearCountdown()
    }
    if (paused || disposed || !nextKey) { clearAutoTimer(); clearCountdown(); return }
    if (autoPlay && autoTimer === null) {
      const epoch = generation, key = nextKey
      autoTimer = setTimeout(() => {
        autoTimer = null
        if (epoch !== generation || key !== decisionIdentity() || !autoPlay || paused) return
        try { autoDecision() } catch (error) { options.onError?.(error) }
      }, 700)
    }
    if (options.countdownEnabled && countdownTimer === null) countdownTimer = setInterval(() => {
      if (paused || disposed) return
      seconds -= 1
      if (seconds <= 0) {
        clearCountdown()
        if (port.actionPrompt.value) action('pass')
        else discard((port.user.value?.hand.length ?? 0) - 1)
      }
      emit()
    }, 1000)
  }

  function release() {
    generation += 1; cancelStart?.(); cancelStart = null
    clearAutoTimer(); clearCountdown(); decisionKey = ''; submittedKey = ''; seconds = 0
    scope?.stop(); scope = null
    const current = port as (ReturnType<typeof useRemoteGame> & { remoteActions?: ReturnType<typeof useRemoteGame>['remoteActions'] }) | undefined
    // A failed remote-engine construction can leave `online` true while `port`
    // still points at the local engine. Detect the actual port capability so
    // cleanup never masks the original connection error with stopPolling.
    if (current?.remoteActions) {
      const savedSession = disposed ? createRemoteSessionStore().loadSession() : null
      current.remoteActions.stopPolling()
      current.remoteActions.clearSession()
      current.startGame()
      if (savedSession) createRemoteSessionStore().saveSession(savedSession)
    } else current?.returnToLobby?.()
  }
  function build() {
    const epoch = generation
    scope = effectScope(true)
    scope.run(() => {
      port = online ? useRemoteGame({ playSound: options.playSound, playSoundAndWait: options.playSoundAndWait, getThemeName: () => 'jade', waitForTableReady: async () => { await options.waitForTableReady?.() } }) : useWuhanGame({
        // Countdown ownership stays here so hiding WeChat cannot discard the user's hand.
        countdownEnabled: false, getThemeName: () => 'jade',
        playSound: (name, volume, done) => {
          if (epoch === generation && !disposed && !paused) return options.playSound?.(name, volume, done)
          done?.()
        },
        playSoundAndWait: async (name, volume) => {
          if (epoch === generation && !disposed && !paused) await options.playSoundAndWait?.(name, volume)
        },
        humanPlayerSeed: { name: identity.nickname === '微信玩家' ? '巅峰雀神' : identity.nickname, avatar: identity.avatarUrl || 'assets/avatars/lotus.png', playerKind: 'human' },
        aiPlayerSeeds: [
          { name: '南粤阿乐', avatar: 'assets/avatars/ah-lok.png', playerKind: 'bot' },
          { name: '西关十三姨', avatar: 'assets/avatars/shisan.png', playerKind: 'bot' },
          { name: '东山少爷', avatar: 'assets/avatars/young-master.png', playerKind: 'bot' },
        ],
      })
      watchEffect(() => {
        syncTimers()
        const state = snapshot()
        if (!disposed) options.onChange?.(state)
      }, { flush: 'post' })
    })
  }

  async function start(settings: { ruleVariant?: string; matchType?: MatchType; gameMode?: string } = {}) {
    if (disposed) throw new Error('The mini game has been disposed')
    if (settings.ruleVariant && settings.ruleVariant !== MINI_RULE_VARIANT) throw new Error('小游戏仅支持武汉晃晃')
    if (settings.gameMode && settings.gameMode !== 'local') throw new Error('小游戏暂仅支持单机对战')
    if (settings.matchType && !['east', 'hanchan'].includes(settings.matchType)) throw new Error('Unknown match type')
    release(); online = false; autoPlay = false; build()
    const cancelled = new Promise<void>(resolve => { cancelStart = resolve })
    const opening = Promise.resolve(port.startGame(settings.matchType ?? 'east')).then(() => {})
    emit()
    await Promise.race([opening, cancelled])
  }
  function selectTile(index: number) {
    if (disposed || paused || disconnected() || !Number.isInteger(index) || index < 0 || index >= (port.user.value?.hand.length ?? 0)) return false
    if (!port.isUserTurn.value) return false
    port.selectTile(index); return true
  }
  function discard(index = port.selectedIndex.value) {
    if (disposed || paused || disconnected() || !port.isUserTurn.value || !Number.isInteger(index) || index < 0 || index >= (port.user.value?.hand.length ?? 0)) return false
    const key = decisionIdentity()
    if (!online && submittedKey === key) return false
    submittedKey = key
    clearAutoTimer(); port.userDiscard(index); return true
  }
  function action(id: string, payload: { tile?: TileType; optionIndex?: number; index?: number } = {}) {
    if (id === 'gang' && payload.tile) id = `gang:${payload.tile}`
    if (id === 'chi' && payload.optionIndex !== undefined) id = `chi:${payload.optionIndex}`
    const item = actions().find(candidate => candidate.id === id)
    if (!item) return false
    if (id === 'discard') return discard(payload.index)
    const key = decisionIdentity()
    if (!online && submittedKey === key) return false
    submittedKey = key
    clearAutoTimer()
    if (id === 'hu') port.userHu()
    else if (id === 'peng') port.userPeng()
    else if (id === 'pass') port.userPass()
    else if (id === 'gang-discard') port.userGangFromDiscard()
    else if (item.type === 'gang') port.userGang(item.tile)
    else if (item.type === 'chi') port.capabilities.value.chi?.choose(item.optionIndex!)
    return true
  }
  function backToLobby() { if (disposed) return; release(); online = false; autoPlay = false; build(); emit() }
  function nextRound() { if (!disposed && !paused && !disconnected() && port.phase.value === 'settled') { port.nextRound(); emit() } }
  function setAutoPlay(enabled: boolean) { if (online) { remote().toggleAutoPlay(); return } if (disposed) return; autoPlay = !!enabled; clearAutoTimer(); syncTimers(); emit() }
  function pause() { paused = true; clearAutoTimer(); clearCountdown(); emit() }
  function resume() { paused = false; syncTimers(); emit() }
  function clearSelection() { if (!disposed) port.clearUserSelection() }
  function hint() {
    if (disposed || paused || disconnected() || !port.isUserTurn.value || !port.user.value) return false
    const waits = port.userTingOptions.value
    const tile = [...waits].sort((a, b) => b.remaining - a.remaining)[0]?.discard
    const index = tile ? port.user.value.hand.indexOf(tile) : chooseFallbackDiscardIndex(port.user.value.hand, port.jokerTiles.value)
    return selectTile(index)
  }
  function dispose() { if (!disposed) { disposed = true; release() } }
  async function enterOnline(profile: typeof identity, roomId?: string, match: MatchType = 'east') {
    release(); online = true; identity = profile; build()
    remote().nickname.value = profile.nickname
    try {
      if (roomId) await remote().remoteActions.joinRoom(roomId)
      else await remote().remoteActions.createRoom(match, 4, MINI_RULE_VARIANT, false)
    } catch (error) {
      const message = remote().sessionError?.value || (error instanceof Error ? error.message : '联机房间连接失败')
      backToLobby()
      throw new Error(message)
    }
    emit()
  }
  async function resumeOnline(profile: typeof identity) {
    release(); online = true; identity = profile; build()
    await remote().remoteActions.resumeSession()
    emit()
  }
  async function leaveOnline() {
    if (online) await remote().remoteActions.leaveRoom()
    backToLobby()
  }
  build()
  return { setProfile: (profile: typeof identity) => { identity = { nickname: profile.nickname, avatarUrl: profile.avatarUrl }; emit() }, enterOnline, resumeOnline, leaveOnline, readyOnline: () => remote().remoteActions.toggleReady(),
    startOnline: () => remote().remoteActions.startMatch(), start, snapshot, selectTile, select: selectTile, discard, action, nextRound, backToLobby,
    setAutoPlay, pause, resume, clearSelection, hint, dispose, tileName, tileAssetPath }
}
