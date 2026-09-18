import type { RoundResult } from '../../core/contracts/gamePort'
import type { TableActionType, TileType } from '../../core/contracts/types'
import { removeLastDiscard } from '../../core/rules/actions'
import { createSettlementTimeline } from '../../shared/settlement/settlementTimeline'
import { capWuhanPayment, wuhanKongKinds, wuhanKongLabel, wuhanKongMultiplier, wuhanSettlementKongKinds } from './ruleProfile'
import { evaluateWuhanWin, isWuhanStandardWin, withWuhanWinScenes, wuhanDiscarderMultiplier, wuhanGetsSelfDrawBonus, wuhanMeetsMinimum, wuhanPatternPoints, wuhanWinPayment, WUHAN_RULESET } from './rules'
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
  const settlementKongs = (winnerIndex: number, joker: TileType | undefined, kongBloom = false) => (
    wuhanSettlementKongKinds(state.players, winnerIndex, joker, kongBloom)
  )
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
      const exposedMelds = winner.melds.filter(meld => meld.type !== 'flower')
      const exposedTiles = exposedMelds.flatMap(meld => meld.tiles)
      const joker = state.jokerTiles.value[0]
      const ordinaryJokers = !endOptions.selfDraw && endOptions.winTile === joker ? [endOptions.winTile] : []
      const menQianQing = winner.melds.every(meld => meld.type === 'angang' || meld.type === 'flower')
      const selfDrawStyle = Boolean(endOptions.selfDraw || endOptions.robbedKong)
      const baseKinds = evaluateWuhanWin(winHand, { exposed, exposedTiles, exposedMelds, joker, ordinaryJokers, menQianQing, selfDraw: selfDrawStyle })
      const kinds = withWuhanWinScenes(baseKinds, winHand, {
        exposed,
        joker,
        selfDraw: Boolean(endOptions.selfDraw),
        discardWin: !endOptions.selfDraw && !endOptions.robbedKong,
        kongBloom: Boolean(endOptions.kongBloom),
        robbedKong: Boolean(endOptions.robbedKong),
      })
      const hard = !joker || !winHand.includes(joker)
      const discardWin = !endOptions.selfDraw && !endOptions.robbedKong
      const kongs = settlementKongs(winnerIndex, joker, Boolean(endOptions.kongBloom))
      const payment = wuhanWinPayment(kinds, selfDrawStyle, hard, kongs, discardWin)
      const payer = discardWin ? endOptions.sourceFrom : null
      const discarderMultiplier = wuhanDiscarderMultiplier(kinds, discardWin)
      const payerKongKinds = state.players.map((player) => wuhanKongKinds(player.melds, joker))
      const payerKongMultipliers = payerKongKinds.map((playerKongs) => wuhanKongMultiplier(playerKongs))
      const payerKongDetails = payerKongKinds.map((playerKongs) => playerKongs.map((kind) => ({
        label: wuhanKongLabel(kind),
        multiplier: kind === 'concealed' || kind === 'joker' ? 4 : 2,
      })))
      const payerPayments = state.players.map((_, playerIndex) => (
        playerIndex === winnerIndex ? 0 : capWuhanPayment(
          payment * payerKongMultipliers[playerIndex] * (playerIndex === payer ? discarderMultiplier : 1),
        )
      ))
      const totalWon = ruleset.score.applyWinScore(
        state.players, winnerIndex, payment, payer, undefined, discarderMultiplier, payerKongMultipliers,
      )
      const hasOtherBigKind = kinds.some(kind => kind !== '屁胡' && kind !== '门前清')
      const detailKinds = kinds.some(kind => kind !== '屁胡')
        ? kinds.filter(kind => kind !== '屁胡')
        : kinds
      return {
        winnerIndex,
        winner: winner.name,
        multiplier: payment,
        totalMultiplier: payment,
        points: payment,
        paymentPerPayer: payerPayments.find((amount, playerIndex) => playerIndex !== winnerIndex && amount > 0) ?? payment,
        ...(discardWin ? { discarderPayment: payerPayments[payer ?? -1] } : {}),
        payerPayments,
        payerKongDetails,
        totalWon,
        details: [
          ...detailKinds.map((label) => {
            const menQianQingMultiplier = label === '门前清' && hasOtherBigKind
            return {
              label: menQianQingMultiplier ? '门前清' : `底分·${label}`,
              ...(menQianQingMultiplier
                ? { multiplier: 2 }
                : { points: label === '屁胡' ? (selfDrawStyle ? 3 : 1) : wuhanPatternPoints(label) }),
            }
          }),
          ...(selfDrawStyle && wuhanGetsSelfDrawBonus(kinds) ? [{ label: '大胡自摸', multiplier: 1.5 }] : []),
          { label: hard ? '硬胡' : '软胡', multiplier: hard ? 2 : 1 },
          ...(discardWin ? [{ label: '放炮者加付', multiplier: discarderMultiplier }] : []),
          ...kongs.map((kind) => ({ label: `杠番·${wuhanKongLabel(kind)}`, multiplier: kind === 'concealed' || kind === 'joker' ? 4 : 2 })),
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
    const exposed = options.structuralMeldCount(winnerIndex)
    const exposedMelds = winner.melds.filter(meld => meld.type !== 'flower')
    const exposedTiles = exposedMelds.flatMap(meld => meld.tiles)
    const ordinaryJokers = endOptions.winTile === state.jokerTiles.value[0] && !endOptions.selfDraw ? [endOptions.winTile] : []
    const joker = state.jokerTiles.value[0]
    // `isWinningHand` intentionally omits 屁胡 when there are two or more
    // jokers. A 杠上开花 is nevertheless a valid 大胡 scene in that case,
    // provided the underlying four-meld-and-a-pair shape is complete.
    // Check the shape first, then apply the Wuhan-specific pattern/minimum
    // rules below so the scene is not discarded before it can be evaluated.
    if (!isWuhanStandardWin(hand, exposed, joker, ordinaryJokers)) return false
    const menQianQing = winner.melds.every(meld => meld.type === 'angang' || meld.type === 'flower')
    const selfDrawStyle = Boolean(endOptions.selfDraw || endOptions.robbedKong)
    const baseKinds = evaluateWuhanWin(hand, { exposed, exposedTiles, exposedMelds, joker, ordinaryJokers, menQianQing, selfDraw: selfDrawStyle })
    const kinds = withWuhanWinScenes(baseKinds, hand, {
      exposed,
      joker,
      selfDraw: Boolean(endOptions.selfDraw),
      discardWin: !endOptions.selfDraw && !endOptions.robbedKong,
      kongBloom: Boolean(endOptions.kongBloom),
      robbedKong: Boolean(endOptions.robbedKong),
    })
    return wuhanMeetsMinimum(
      kinds,
      selfDrawStyle,
      !joker || !hand.includes(joker),
      settlementKongs(winnerIndex, joker, Boolean(endOptions.kongBloom)),
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
