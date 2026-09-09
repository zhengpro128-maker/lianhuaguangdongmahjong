import type { RoundResult } from '../../core/contracts/gamePort'
import type { Meld, TableActionType, TileType } from '../../core/contracts/types'
import { removeLastDiscard } from '../../core/rules/actions'
import { createSettlementTimeline } from '../../shared/settlement/settlementTimeline'
import type { WuhanKongKind } from './ruleProfile'
import { evaluateWuhanWin, withWuhanWinScenes, wuhanWinPayment, WUHAN_RULESET } from './rules'
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

function kongKinds(melds: readonly Meld[], joker: TileType | undefined): WuhanKongKind[] {
  return melds.flatMap((meld): WuhanKongKind[] => {
    if (meld.type === 'flower' && meld.tile === 'red') return ['red']
    if (meld.type === 'angang') return [meld.tile === joker ? 'joker' : 'concealed']
    if (meld.type === 'gang') return [meld.added ? 'added' : 'discard']
    return []
  })
}

export function createWuhanSettlement(options: Options) {
  const { state } = options
  const ruleset = options.ruleset ?? WUHAN_RULESET
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
      const joker = state.jokerTiles.value[0]
      const ordinaryJokers = !endOptions.selfDraw && endOptions.winTile === joker ? [endOptions.winTile] : []
      const baseKinds = evaluateWuhanWin(winHand, { exposed, joker, ordinaryJokers })
      const kinds = withWuhanWinScenes(baseKinds, winHand, {
        exposed,
        joker,
        selfDraw: Boolean(endOptions.selfDraw),
        discardWin: !endOptions.selfDraw && !endOptions.robbedKong,
        kongBloom: Boolean(endOptions.kongBloom),
        robbedKong: Boolean(endOptions.robbedKong),
      })
      const hard = !joker || !winHand.includes(joker)
      const payment = wuhanWinPayment(kinds, Boolean(endOptions.selfDraw || endOptions.robbedKong), hard, kongKinds(winner.melds, joker))
      const payer = endOptions.selfDraw || endOptions.robbedKong ? null : endOptions.sourceFrom
      const totalWon = ruleset.score.applyWinScore(state.players, winnerIndex, payment, payer)
      return {
        winnerIndex,
        winner: winner.name,
        multiplier: payment,
        totalMultiplier: payment,
        points: payment,
        totalWon,
        details: [
          ...kinds.map((label) => ({ label })),
          { label: hard ? '硬胡' : '软胡', multiplier: hard ? 2 : 1 },
          ...kongKinds(winner.melds, joker).map((kind) => ({ label: `杠番·${kind}`, multiplier: kind === 'concealed' || kind === 'joker' ? 4 : 2 })),
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
    return ruleset.win.isWinningHand(hand, options.structuralMeldCount(winnerIndex), {
      jokers: state.jokerTiles.value,
      ordinaryJokers: endOptions.winTile === state.jokerTiles.value[0] && !endOptions.selfDraw ? [endOptions.winTile] : [],
    })
  }

  return {
    ...timeline,
    endGame(winnerIndex: number, endOptions: WuhanEndGameOptions = {}) {
      if (!isLegalWin(winnerIndex, endOptions)) return
      return timeline.endGame(winnerIndex, endOptions)
    },
  }
}
