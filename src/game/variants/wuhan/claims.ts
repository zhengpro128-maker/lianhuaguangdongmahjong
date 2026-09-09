import type { TileType } from '../../core/contracts/types'

export type WuhanClaim = { seat: number; kind: 'gang' | 'peng' | 'chi'; tiles?: TileType[] }
const same = (hand: readonly TileType[], tile: TileType) => hand.filter(item => item === tile).length

export function wuhanChiOptions(hand: readonly TileType[], tile: TileType): TileType[][] {
  const match = /^([mps])([1-9])$/.exec(tile)
  if (!match) return []
  const suit = match[1]; const rank = Number(match[2]); const result: TileType[][] = []
  for (let start = Math.max(1, rank - 2); start <= Math.min(7, rank); start += 1) {
    const sequence = [0, 1, 2].map(offset => `${suit}${start + offset}` as TileType)
    const need = sequence.filter(item => item !== tile)
    if (need.every(item => same(hand, item) >= need.filter(other => other === item).length)) result.push(sequence)
  }
  return result
}

/** 红中不能被他家吃碰杠；其余弃牌按杠、碰、吃优先级列出。 */
export function findWuhanClaims(hands: readonly TileType[][], from: number, tile: TileType): WuhanClaim[] {
  if (tile === 'red') return []
  const candidates: WuhanClaim[] = []
  hands.forEach((hand, seat) => {
    if (seat === from) return
    const amount = same(hand, tile)
    if (amount >= 3) candidates.push({ seat, kind: 'gang' })
    else if (amount >= 2) candidates.push({ seat, kind: 'peng' })
    if (seat === (from + 1) % hands.length) for (const tiles of wuhanChiOptions(hand, tile)) candidates.push({ seat, kind: 'chi', tiles })
  })
  const priority = { gang: 0, peng: 1, chi: 2 }
  return candidates.sort((a, b) => priority[a.kind] - priority[b.kind] || ((a.seat - from + 4) % 4) - ((b.seat - from + 4) % 4))
}
