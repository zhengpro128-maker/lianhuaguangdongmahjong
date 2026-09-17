import type { RoundResult } from '../../core/contracts/gamePort'
import type { TableActionType, TileType } from '../../core/contracts/types'
import { removeLastDiscard } from '../../core/rules/actions'
import { createSettlementTimeline } from '../../shared/settlement/settlementTimeline'
import { wuhanKongKinds } from './ruleProfile'
import { evaluateWuhanWin, withWuhanWinScenes, wuhanMeetsMinimum, wuhanPatternPoints, wuhanWinPayment, WUHAN_RULESET } from './rules'
import type { WuhanEndGameOptions, WuhanGameState } from './wuhanState'
import type { RuleSet } from '../../core/rules/ruleset'

interface Options {
  state: WuhanGameState
  clearTimers(): void
  later(callback: () => void, delay: number): number
  playSound(name: string, volume?: number): unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  showTableAction(type: TableActionType, actorIndex: number, sourceIndex: number | null, tile: TileType, meldIndex: number): void
  structuralMeldCount(playerIndex: number): number
  getRoundLabel(): string
  ruleset?: RuleSet
  getThemeName?: () => string
  animeFixedTts?: unknown
}

export function createWuhanSettlement(options: Options) {
  const { state } = options
  const ruleset = options.ruleset ?? WUHAN_RULESET
  const settlementKongs = (winnerIndex: number, joker: TileType | undefined) => [
    ...wuhanKongKinds(state.players[winnerIndex].melds, joker).filter(kind => kind !== 'red'),
    ...state.players.flatMap(player => wuhanKongKinds(player.melds, joker).filter(kind => kind === 'red')),
  ]
  const timeline = createSettlementTimeline<WuhanEndGameOptions>({
    ...options,
    takeRobbedKongTile: (playerIndex, tile, winnerIndex) => {
      const player = playerIndex == null ? undefined : state.players[playerIndex]
      const meldIndex = player?.melds.findIndex((meld) => meld.type === 'gang' && meld.added && meld.pending && meld.tile === tile) ?? -1
      if (!player || meldIndex < 0) return -1
      const meld = player.melds[meldIndex]
      player.melds[meldIndex] = { ...meld, type: 'peng', tiles: meld.tiles.slice(0, 3), added: false, pending: false }
      state.players[winnerIndex]?.hand.push(tile)
      return meldIndex
    },
    settleWinningDiscard: (from, tile) => {
      if (!Number.isInteger(from)) return
      const source = state.players[from!]
      if (source?.discards.at(-1) === tile) removeLastDiscard(source.discards, tile)
      state.lastDiscard.value = null
    },
    getTableAction: ({ endOptions }) => ({
      type: endOptions.robbedKong ? 'robbed-kong-win' : endOptions.selfDraw ? 'self-draw' : 'discard-win',
      sourceIndex: endOptions.robbedKong ? (endOptions.robbedKongPlayerIndex ?? null) : (endOptions.sourceFrom ?? null),
    }),
    getWinSound: ({ endOptions }) => endOptions.selfDraw ? 'zimo.mp3' : 'hu.mp3',
    finalizeWin: ({ winnerIndex, winner, endOptions }): RoundResult => {
      const winHand = endOptions.winHand ?? (endOptions.winTile && !endOptions.selfDraw
        ? [...winner.hand, endOptions.winTile]
        : [...winner.hand])
      const exposed = options.structuralMeldCount(winnerIndex)
      const exposedTiles = winner.melds.filter(meld => meld.type !== 'flower').flatMap(meld => meld.tiles)
      const joker = state.jokerTiles.value[0]
      const ordinaryJokers = !endOptions.selfDraw && endOptions.winTile === joker ? [endOptions.winTile] : []
      const menQianQing = winner.melds.every(meld => meld.type === 'angang' || meld.type === 'flower')
      const baseKinds = evaluateWuhanWin(winHand, { exposed, exposedTiles, joker, ordinaryJokers, menQianQing })
      const kinds = withWuhanWinScenes(baseKinds, winHand, {
        exposed,
        joker,
        selfDraw: Boolean(endOptions.selfDraw),
        discardWin: !endOptions.selfDraw && !endOptions.robbedKong,
        kongBloom: Boolean(endOptions.kongBloom),
        robbedKong: Boolean(endOptions.robbedKong),
      })
      const hard = !joker || !winHand.includes(joker)
      const selfDrawStyle = Boolean(endOptions.selfDraw || endOptions.robbedKong)
      const discardWin = !endOptions.selfDraw && !endOptions.robbedKong
      const kongs = settlementKongs(winnerIndex, joker)
      const payment = wuhanWinPayment(kinds, selfDrawStyle, hard, kongs, discardWin)
      const payer = discardWin ? endOptions.sourceFrom : null
      const totalWon = ruleset.score.applyWinScore(state.players, winnerIndex, payment, payer)
      const hasOtherBigKind = kinds.some(kind => kind !== '屁胡' && kind !== '门前清')
      return {
        winnerIndex,
        winner: winner.name,
        multiplier: payment,
        totalMultiplier: payment,
        points: payment,
        paymentPerPayer: payment,
        totalWon,
        details: [
          ...kinds.map((label) => ({
            label,
            ...(label === '门前清' && hasOtherBigKind
              ? { multiplier: 6 }
              : { points: label === '屁胡' ? (selfDrawStyle ? 3 : 1) : wuhanPatternPoints(label) }),
          })),
          ...(selfDrawStyle && kinds.some(kind => kind !== '屁胡') ? [{ label: '大胡自摸', multiplier: 1.5 }] : []),
          { label: hard ? '硬胡' : '软胡', multiplier: hard ? 2 : 1 },
          ...(discardWin && kinds.some(kind => kind !== '屁胡') ? [{ label: '大胡点炮', multiplier: 1.2 }] : []),
          ...(discardWin ? [{ label: '放炮者额外支付', points: 2 }] : []),
          ...kongs.map((kind) => ({ label: `杠番·${kind}`, multiplier: kind === 'concealed' || kind === 'joker' ? 4 : 2 })),
        ],
        winType: endOptions.robbedKong ? 'robbed-kong' : endOptions.selfDraw ? 'self-draw' : 'discard',
        ...endOptions,
      }
    },
    endDraw: (): RoundResult => {
      const tenpai = state.players.flatMap((player, playerIndex) => (
        ruleset.win.waitingTiles(player.hand, options.structuralMeldCount(playerIndex), { jokers: state.jokerTiles.value }).length
          ? [playerIndex]
          : []
      ))
      return { draw: true, winner: '荒庄', points: 0, details: [], tenpai, dealerTenpai: tenpai.includes(state.dealer.value) }
    },
  })

  function isLegalWin(winnerIndex: number, endOptions: WuhanEndGameOptions) {
    const winner = state.players[winnerIndex]
    if (!winner) return false
    const hand = endOptions.selfDraw
      ? winner.hand
      : endOptions.winTile ? [...winner.hand, endOptions.winTile] : null
    if (!hand) return false
    if (!endOptions.selfDraw && !endOptions.robbedKong && (hand.includes('green') || hand.includes('white'))) return false
    const exposed = options.structuralMeldCount(winnerIndex)
    const exposedTiles = winner.melds.filter(meld => meld.type !== 'flower').flatMap(meld => meld.tiles)
    const ordinaryJokers = endOptions.winTile === state.jokerTiles.value[0] && !endOptions.selfDraw ? [endOptions.winTile] : []
    if (!ruleset.win.isWinningHand(hand, exposed, {
      jokers: state.jokerTiles.value,
      ordinaryJokers,
    })) return false
    const joker = state.jokerTiles.value[0]
    const menQianQing = winner.melds.every(meld => meld.type === 'angang' || meld.type === 'flower')
    const baseKinds = evaluateWuhanWin(hand, { exposed, exposedTiles, joker, ordinaryJokers, menQianQing })
    const kinds = withWuhanWinScenes(baseKinds, hand, {
      exposed,
      joker,
      selfDraw: Boolean(endOptions.selfDraw),
      discardWin: !endOptions.selfDraw && !endOptions.robbedKong,
      kongBloom: Boolean(endOptions.kongBloom),
      robbedKong: Boolean(endOptions.robbedKong),
    })
    const selfDrawStyle = Boolean(endOptions.selfDraw || endOptions.robbedKong)
    return wuhanMeetsMinimum(
      kinds,
      selfDrawStyle,
      !joker || !hand.includes(joker),
      settlementKongs(winnerIndex, joker),
      !endOptions.selfDraw && !endOptions.robbedKong,
    )
  }

  return {
    ...timeline,
    isLegalWin,
    endGame(winnerIndex: number, endOptions: WuhanEndGameOptions = {}) {
      if (!isLegalWin(winnerIndex, endOptions)) return
      return timeline.endGame(winnerIndex, endOptions)
    },
  }
}
