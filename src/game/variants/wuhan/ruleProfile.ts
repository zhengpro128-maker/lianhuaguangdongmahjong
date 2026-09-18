import type { Meld, TileType } from '../../core/contracts/types'
import { shuffle } from '../../core/rules/tiles'

/** 武汉晃晃只使用三门数牌和中发白，共 120 张。 */
export const WUHAN_TILE_TYPES = [
  ...(['m', 'p', 's'] as const).flatMap((suit) =>
    Array.from({ length: 9 }, (_, index) => `${suit}${index + 1}` as TileType)),
  'red', 'green', 'white',
] as const satisfies readonly TileType[]

export const WUHAN_WALL_SIZE = 120
export const WUHAN_DRAW_STOP_COUNT = 8
export const WUHAN_LOSS_CAP = 50

/**
 * 武汉晃晃的赖子不是通用的字牌循环：红中与白板翻出后都指向发财。
 * 因此必须维护显式映射，不能复用其它玩法的“下一张”算法。
 */
export function wuhanJokerForIndicator(indicator: TileType): TileType {
  const suited = /^([mps])([1-9])$/.exec(indicator)
  if (suited) {
    const rank = Number(suited[2]) % 9 + 1
    return `${suited[1]}${rank}` as TileType
  }
  if (indicator === 'green') return 'white'
  return 'green' // 红中、白板均翻发财为赖子。
}

export function createWuhanWall(random: () => number = Math.random): TileType[] {
  return shuffle(WUHAN_TILE_TYPES.flatMap((tile) => Array<TileType>(4).fill(tile)), random)
}

export type WuhanKongKind = 'red' | 'discard' | 'added' | 'concealed' | 'joker'

/** 结算展示使用中文杠种，避免把内部枚举值暴露给玩家。 */
export function wuhanKongLabel(kind: WuhanKongKind): string {
  switch (kind) {
    case 'red': return '红中杠'
    case 'discard': return '明杠'
    case 'added': return '补杠'
    case 'concealed': return '暗杠'
    case 'joker': return '癞子杠'
  }
}

export function wuhanKongKinds(melds: readonly Meld[], joker: TileType | undefined): WuhanKongKind[] {
  return melds.flatMap((meld): WuhanKongKind[] => {
    // `flower` 是跨玩法共用的展示类型；结算必须依据开杠时写入的凭据，
    // 不能把牌面恰好为红中/本局癞子的花牌误算为杠。
    if (meld.type === 'flower' && meld.specialKong === 'red' && meld.tile === 'red') return ['red']
    if (meld.type === 'flower' && meld.specialKong === 'joker' && meld.tile === joker) return ['joker']
    if (meld.type === 'angang') return [meld.tile === joker ? 'joker' : 'concealed']
    if (meld.type === 'gang') return [meld.added ? 'added' : 'discard']
    return []
  })
}

/**
 * 胡牌分只统计胡家自己的杠番；其他玩家的杠按其自身动作独立结算，不能并入胡家。
 * 杠上开花的底分已经包含开杠本身，因此再从胡家记录的最后一杠中扣除一杠。
 */
export function wuhanSettlementKongKinds(
  players: ReadonlyArray<{ melds: readonly Meld[] }>,
  winnerIndex: number,
  joker: TileType | undefined,
  kongBloom: boolean,
): WuhanKongKind[] {
  const kinds = wuhanKongKinds(players[winnerIndex]?.melds ?? [], joker)
  return kongBloom ? kinds.slice(0, -1) : kinds
}

/** 以“番”为指数：1 番=×2，2 番=×4；多次杠相乘。 */
export function wuhanKongMultiplier(kongs: readonly WuhanKongKind[]): number {
  return kongs.reduce((factor, kind) => factor * (kind === 'concealed' || kind === 'joker' ? 4 : 2), 1)
}

export function capWuhanPayment(points: number): number {
  return Math.min(WUHAN_LOSS_CAP, Math.max(0, points))
}
