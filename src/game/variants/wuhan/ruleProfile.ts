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

export function wuhanKongKinds(melds: readonly Meld[], joker: TileType | undefined): WuhanKongKind[] {
  return melds.flatMap((meld): WuhanKongKind[] => {
    if (meld.type === 'flower' && meld.tile === 'red') return ['red']
    if (meld.type === 'angang') return [meld.tile === joker ? 'joker' : 'concealed']
    if (meld.type === 'gang') return [meld.added ? 'added' : 'discard']
    return []
  })
}

/** 以“番”为指数：1 番=×2，2 番=×4；多次杠相乘。 */
export function wuhanKongMultiplier(kongs: readonly WuhanKongKind[]): number {
  return kongs.reduce((factor, kind) => factor * (kind === 'concealed' || kind === 'joker' ? 4 : 2), 1)
}

export function capWuhanPayment(points: number): number {
  return Math.min(WUHAN_LOSS_CAP, Math.max(0, points))
}
