import type { Meld, TileType } from '../../core/contracts/types'
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

/**
 * 只有一张癞子时，若把它按自身牌面而非万能牌仍能组成完整牌型，即为硬胡。
 * 两张及以上癞子不适用此例外，始终按软胡处理。
 */
export function isWuhanHardWin(tiles: readonly TileType[], exposed = 0, joker?: TileType): boolean {
  const jokerCount = joker ? tiles.filter((tile) => tile === joker).length : 0
  if (jokerCount > 1) return false
  // 单张癞子不能继续作为万能牌参与硬胡判定；把它放回真实牌面后仍可胡，
  // 才说明本手牌不依赖替牌。ordinaryJokers 会让标准胡牌求解器保留该牌面。
  return isWuhanStandardWin(tiles, exposed, joker, jokerCount === 1 && joker ? [joker] : [])
}

export type WuhanWinKind = '屁胡' | '碰碰胡' | '清一色' | '门前清' | '全求人' | '七对' | '龙七对' | '双龙七对' | '杠上开花' | '抢杠胡'
export interface WuhanWinContext {
  exposed?: number
  /** 已吃、碰、杠的结构副露牌；清一色等花色牌型必须把它们一并计算。 */
  exposedTiles?: readonly TileType[]
  /**
   * 已亮出的结构副露。碰碰胡除了暗手必须全部由刻子组成，也不能有任何吃牌顺子。
   * 单靠 `exposed` 数量或扁平化的 `exposedTiles` 都无法分辨碰与吃。
   */
  exposedMelds?: readonly Pick<Meld, 'type'>[]
  /** 暗杠和红中单杠不破门前清；未传入时退化为无结构副露。 */
  menQianQing?: boolean
  joker?: TileType
  /** 全求人只在点炮单钓时成立。 */
  discardWin?: boolean
  kongBloom?: boolean
  robbedKong?: boolean
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
    const allNatural = [...natural, ...(context.exposedTiles ?? []).filter(tile => tile !== joker && tile !== 'red')]
    const suits = new Set(allNatural.filter(t => /^[mps]/.test(t)).map(t => t[0])); const honors = allNatural.some(t => t === 'green' || t === 'white')
    if (suits.size === 1 && !honors) kinds.push('清一色')
    const hasExposedSequence = context.exposedMelds?.some((meld) => meld.type === 'chi') ?? false
    const canPengPeng = !hasExposedSequence && usable.some(tile => {
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
  const sevenPairs = kinds.some(kind => kind === '七对' || kind === '龙七对' || kind === '双龙七对')
  // 七对按专属 10 分结算，不再与门前清叠加；其它大牌可与门前清相乘。
  // 门前清必须以自摸（或抢杠）收尾；点炮一律按普通牌型结算。
  if (!sevenPairs && context.selfDraw && (context.menQianQing ?? exposed === 0) && kinds.length) kinds.push('门前清')
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

export const WUHAN_MIN_WIN_POINTS = 9

const BIG_DISCARD_KINDS: readonly WuhanWinKind[] = ['七对', '龙七对', '双龙七对', '清一色', '碰碰胡']

/** 七对、清一色、碰碰胡点炮时，放炮者按 1.2 倍支付；其余点炮仍为 2 倍。 */
export function wuhanDiscarderMultiplier(kinds: readonly WuhanWinKind[], discardWin: boolean) {
  return discardWin && kinds.some((kind) => BIG_DISCARD_KINDS.includes(kind)) ? 1.2 : 2
}

export function wuhanPatternPoints(kind: WuhanWinKind): number {
  if (kind === '双龙七对') return 40
  if (kind === '龙七对') return 20
  if (kind === '门前清') return 6
  return 10
}

export function wuhanRawWinPoints(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false, kongBloom = false,
) {
  const bigKinds = kinds.filter(k => k !== '屁胡')
  const hasOtherBigKind = bigKinds.some(kind => kind !== '门前清')
  const base = bigKinds.length
    ? bigKinds.reduce((points, kind) => (
      points * (kind === '门前清' && hasOtherBigKind ? 2 : wuhanPatternPoints(kind))
    ), 1)
    : kinds.includes('屁胡') ? (selfDraw ? 3 : 1) : 0
  // 门前清和杠上开花都以自摸为成立前提，不能再叠加一次大胡自摸 ×1.5。
  const winTypeMultiplier = selfDraw && wuhanGetsSelfDrawBonus(kinds) ? 1.5 : 1
  return base * (hard ? 2 : 1) * winTypeMultiplier * wuhanKongMultiplier(kongs, kongBloom)
}

export function wuhanGetsSelfDrawBonus(kinds: readonly WuhanWinKind[]) {
  return !kinds.includes('杠上开花') && kinds.some((kind) => kind !== '屁胡' && kind !== '门前清')
}

export function wuhanMeetsMinimum(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false, kongBloom = false,
) {
  // 起胡门槛按本次胡牌的总收分算，而不是按单家付款额算：
  // 自摸三家各付一份（屁胡 3 分 × 三家，硬胡再翻倍即共 18 分）。
  const perPayer = wuhanRawWinPoints(kinds, selfDraw, hard, kongs, discardWin, kongBloom)
  // 点炮三家都付款：七对、清一色、碰碰胡的放炮者付 1.2 倍，其它点炮付 2 倍。
  const total = selfDraw ? perPayer * 3 : perPayer * (2 + wuhanDiscarderMultiplier(kinds, discardWin))
  return total >= WUHAN_MIN_WIN_POINTS
}

export function wuhanWinPayment(
  kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean,
  kongs: readonly WuhanKongKind[], discardWin = false, kongBloom = false,
) {
  return capWuhanPayment(wuhanRawWinPoints(kinds, selfDraw, hard, kongs, discardWin, kongBloom))
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
  _dealerIndex?: number | null, payerMultiplier = 2, payerKongMultipliers: readonly number[] = [],
) {
  let total = 0
  players.forEach((player, index) => {
    if (index === winnerIndex) return
    const kongMultiplier = payerKongMultipliers[index] ?? 1
    const payment = capWuhanPayment(points * kongMultiplier * (index === payerIndex ? payerMultiplier : 1))
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
    // 红中与本局癞子是单张杠：打出即亮杠补摸，不进入常规暗杠选择。
    concealedKongs: (tiles, context) => [...new Set(tiles.filter((tile) => (
      tile !== 'red' && !context?.jokers?.includes(tile) && matchingCount(tiles, tile) === 4
    )))],
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
