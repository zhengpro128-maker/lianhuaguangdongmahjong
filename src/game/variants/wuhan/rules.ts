import type { TileType } from '../../core/contracts/types'
import type { ChiOption } from '../../core/contracts/gamePort'
import type { GamePlayer, ScoreDelta } from '../../core/contracts/types'
import type { RuleEvaluationContext, RuleSet } from '../../core/rules/ruleset'
import { WUHAN_TILE_TYPES, capWuhanPayment, type WuhanKongKind, wuhanKongMultiplier } from './ruleProfile'
import { wuhanChiOptions } from './claims'

type Counts = Map<TileType, number>
const usable = WUHAN_TILE_TYPES.filter((tile) => tile !== 'red')
const count = (tiles: readonly TileType[]) => new Map(tiles.map((tile) => [tile, tiles.filter((item) => item === tile).length])) as Counts
const take = (counts: Counts, tile: TileType, amount: number) => { const next = new Map(counts); next.set(tile, (next.get(tile) ?? 0) - amount); return next }
const first = (counts: Counts) => usable.find((tile) => (counts.get(tile) ?? 0) > 0)

function melds(counts: Counts, jokers: number, left: number, memo = new Map<string, boolean>()): boolean {
  const key = `${left}/${jokers}/${usable.map(t => counts.get(t) ?? 0).join(',')}`
  if (memo.has(key)) return memo.get(key)!
  const tile = first(counts)
  if (!tile) return jokers === left * 3
  if (!left) return false
  const amount = counts.get(tile) ?? 0
  if (3 - Math.min(3, amount) <= jokers && melds(take(counts, tile, Math.min(3, amount)), jokers - (3 - Math.min(3, amount)), left - 1, memo)) return true
  const match = /^([mps])([1-9])$/.exec(tile)
  if (match) for (let start = Math.max(1, Number(match[2]) - 2); start <= Math.min(7, Number(match[2])); start += 1) {
    let next = new Map(counts); let missing = 0
    for (let rank = start; rank < start + 3; rank += 1) { const item = `${match[1]}${rank}` as TileType; if ((next.get(item) ?? 0) > 0) next = take(next, item, 1); else missing += 1 }
    if (missing <= jokers && melds(next, jokers - missing, left - 1, memo)) return true
  }
  memo.set(key, false); return false
}

function splitJokers(tiles: readonly TileType[], joker?: TileType, ordinaryJokers: readonly TileType[] = []) {
  if (!joker) return { wild: 0, natural: [...tiles] }
  const naturalJokerCount = ordinaryJokers.filter((tile) => tile === joker).length
  const allJokers = tiles.filter((tile) => tile === joker).length
  return {
    wild: Math.max(0, allJokers - naturalJokerCount),
    natural: [...tiles.filter((tile) => tile !== joker), ...Array<TileType>(Math.min(allJokers, naturalJokerCount)).fill(joker)],
  }
}

export function isWuhanStandardWin(
  tiles: readonly TileType[], exposed = 0, joker?: TileType, ordinaryJokers: readonly TileType[] = [],
): boolean {
  if (tiles.includes('red') || tiles.length !== (4 - exposed) * 3 + 2) return false
  const { wild: jokers, natural } = splitJokers(tiles, joker, ordinaryJokers)
  const counts = count(natural)
  if (jokers >= 2 && melds(counts, jokers - 2, 4 - exposed)) return true
  return usable.some(tile => (counts.get(tile) ?? 0) >= 2 && melds(take(counts, tile, 2), jokers, 4 - exposed))
    || usable.some(tile => (counts.get(tile) ?? 0) >= 1 && jokers > 0 && melds(take(counts, tile, 1), jokers - 1, 4 - exposed))
}

export type WuhanWinKind = '屁胡' | '碰碰胡' | '清一色' | '门前清' | '全求人' | '七对' | '龙七对' | '双龙七对' | '杠上开花' | '抢杠胡'
export interface WuhanWinContext {
  exposed?: number
  /** 暗杠和红中单杠不破门前清；未传入时退化为无结构副露。 */
  menQianQing?: boolean
  joker?: TileType
  /** 全求人只在点炮单钓时成立。 */
  discardWin?: boolean
  kongBloom?: boolean
  robbedKong?: boolean
  /** 见发财/白板的牌只能自摸或抢杠胡。 */
  selfDraw?: boolean
  /** 点炮/抢杠带入的癞子按自身牌面计算，不作为万能牌。 */
  ordinaryJokers?: readonly TileType[]
}

function tripletsOnly(counts: Counts, jokers: number, left: number): boolean {
  const tile = first(counts)
  if (!tile) return jokers === left * 3
  if (!left) return false
  const amount = counts.get(tile) ?? 0
  const used = Math.min(3, amount)
  return 3 - used <= jokers && tripletsOnly(take(counts, tile, used), jokers - (3 - used), left - 1)
}

export function evaluateWuhanWin(tiles: readonly TileType[], context: WuhanWinContext = {}): WuhanWinKind[] {
  const exposed = context.exposed ?? 0
  const joker = context.joker
  if (tiles.includes('red')) return []
  const { wild, natural } = splitJokers(tiles, joker, context.ordinaryJokers)
  const kinds: WuhanWinKind[] = []
  const standard = isWuhanStandardWin(tiles, exposed, joker, context.ordinaryJokers)
  if (standard && wild <= 1) kinds.push('屁胡')
  if (standard) {
    const suits = new Set(natural.filter(t => /^[mps]/.test(t)).map(t => t[0])); const honors = natural.some(t => t === 'green' || t === 'white')
    if (suits.size === 1 && !honors) kinds.push('清一色')
    const canPengPeng = usable.some(tile => {
      const amount = countsFor(natural).get(tile) ?? 0
      const remaining = take(countsFor(natural), tile, Math.min(2, amount))
      return 2 - Math.min(2, amount) <= wild && tripletsOnly(remaining, wild - (2 - Math.min(2, amount)), 4 - exposed)
    })
    if (canPengPeng) kinds.push('碰碰胡')
  }
  if (!exposed && tiles.length === 14) {
    const values = [...count(natural).values()]
    const singles = values.filter((amount) => amount % 2 === 1).length
    const naturalPairs = values.reduce((total, amount) => total + Math.floor(amount / 2), 0)
    const remainingWild = wild - singles
    const pairs = remainingWild >= 0 && remainingWild % 2 === 0
      ? naturalPairs + singles + remainingWild / 2
      : 0
    if (pairs === 7) {
      const quads = values.filter((amount) => amount === 4).length
      kinds.push(quads > 1 ? '双龙七对' : quads ? '龙七对' : '七对')
    }
  }
  if ((context.menQianQing ?? exposed === 0) && kinds.length) kinds.push('门前清')
  return kinds
}

const countsFor = (tiles: readonly TileType[]) => count(tiles)

export const matchingCount = (tiles: readonly TileType[], tile: TileType) => tiles.filter((item) => item === tile).length

export type ChiMeld = ChiOption

/** 武汉晃晃只允许下家吃普通数牌顺子；赖子按本身牌面参与。 */
export function canChi(hand: readonly TileType[], tile: TileType, _jokers: readonly TileType[] = []): ChiMeld[] {
  return wuhanChiOptions(hand, tile).map((tiles) => ({ kind: 'sequence', tiles }))
}

/** Adds scene-specific large hands after the base hand is independently legal. */
export function withWuhanWinScenes(kinds: readonly WuhanWinKind[], tiles: readonly TileType[], context: WuhanWinContext): WuhanWinKind[] {
  const result = [...kinds]
  if (context.exposed === 4 && context.discardWin) result.push('全求人')
  if (context.kongBloom) result.push('杠上开花')
  if (context.robbedKong) result.push('抢杠胡')
  return result
}

export const WUHAN_MIN_WIN_POINTS = 10

export function wuhanRawWinPoints(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false,
) {
  const bigKinds = kinds.filter(k => k !== '屁胡')
  const base = bigKinds.length
    ? bigKinds.reduce((points, kind) => points + (kind === '门前清' ? 6 : 10), 0)
    : kinds.includes('屁胡') ? (selfDraw ? 3 : 1) : 0
  const winTypeMultiplier = selfDraw
    ? (bigKinds.length ? 1.5 : 1)
    : discardWin && bigKinds.length ? 1.2 : 1
  return base * (hard ? 2 : 1) * winTypeMultiplier * wuhanKongMultiplier(kongs)
}

export function wuhanMeetsMinimum(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false,
) {
  return wuhanRawWinPoints(kinds, selfDraw, hard, kongs, discardWin) >= WUHAN_MIN_WIN_POINTS
}

export function wuhanWinPayment(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false,
) {
  return capWuhanPayment(wuhanRawWinPoints(kinds, selfDraw, hard, kongs, discardWin))
}

function contextJoker(context?: RuleEvaluationContext) {
  return context?.jokers?.[0]
}

function winningKinds(tiles: readonly TileType[], exposed: number, context?: RuleEvaluationContext) {
  return evaluateWuhanWin(tiles, { exposed, joker: contextJoker(context), ordinaryJokers: context?.ordinaryJokers })
}

function waitingTiles(tiles: TileType[], exposed = 0, context?: RuleEvaluationContext): TileType[] {
  return WUHAN_TILE_TYPES
    .filter((tile) => tile !== 'red')
    .filter((tile) => winningKinds([...tiles, tile], exposed, context).length > 0)
}

function applyNoImmediateKongScore(): ScoreDelta[] {
  // 武汉晃晃的杠番随最终胡牌一起计算，不在开杠时重复收付。
  return []
}

function applyWinnerPayment(
  players: GamePlayer[], winnerIndex: number, points: number, payerIndex?: number | null,
) {
  let total = 0
  players.forEach((player, index) => {
    if (index === winnerIndex) return
    const payment = capWuhanPayment(points + (index === payerIndex ? 2 : 0))
    player.score -= payment
    total += payment
  })
  players[winnerIndex].score += total
  return total
}

export const WUHAN_RULESET: RuleSet = {
  id: 'wuhan-huanghuang',
  baseScore: 1,
  flow: { mode: 'single-win', continueAfterWin: false, allowMultipleWinners: false },
  win: {
    isWinningHand: (tiles, exposed = 0, context) => winningKinds(tiles, exposed, context).length > 0,
    waitingTiles,
    canRobKong: (tiles, kongTile, exposed = 0, context) => (
      winningKinds([...tiles, kongTile], exposed, context).length > 0
    ),
    concealedKongs: (tiles) => [...new Set(tiles.filter((tile) => tile !== 'red' && matchingCount(tiles, tile) === 4))],
    evaluatePattern: (tiles, exposed, context) => {
      const kinds = winningKinds(tiles, exposed, context)
      return kinds.length ? { pattern: kinds.join('、'), fan: kinds.filter((kind) => kind !== '屁胡').length || 1 } : null
    },
  },
  score: {
    scoreHand: () => ({ multiplier: 1, totalMultiplier: 1, horsePoints: 0, points: 1, details: [] }),
    applyKongScore: applyNoImmediateKongScore,
    applyWinScore: applyWinnerPayment,
  },
}
