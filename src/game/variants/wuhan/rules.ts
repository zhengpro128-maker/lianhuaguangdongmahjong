import type { TileType } from '../../core/contracts/types'
import { WUHAN_TILE_TYPES, capWuhanPayment, type WuhanKongKind, wuhanKongMultiplier } from './ruleProfile'

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

export function isWuhanStandardWin(tiles: readonly TileType[], exposed = 0, joker?: TileType): boolean {
  if (tiles.includes('red') || tiles.length !== (4 - exposed) * 3 + 2) return false
  const jokers = joker ? tiles.filter(t => t === joker).length : 0
  const counts = count(tiles.filter(t => t !== joker))
  if (jokers >= 2 && melds(counts, jokers - 2, 4 - exposed)) return true
  return usable.some(tile => (counts.get(tile) ?? 0) >= 2 && melds(take(counts, tile, 2), jokers, 4 - exposed))
    || usable.some(tile => (counts.get(tile) ?? 0) >= 1 && jokers > 0 && melds(take(counts, tile, 1), jokers - 1, 4 - exposed))
}

export type WuhanWinKind = '屁胡' | '碰碰胡' | '清一色' | '将一色' | '风一色' | '七对' | '龙七对' | '双龙七对'
export function evaluateWuhanWin(tiles: readonly TileType[], exposed = 0, joker?: TileType): WuhanWinKind[] {
  if (tiles.includes('red')) return []
  const wild = joker ? tiles.filter(t => t === joker).length : 0
  const natural = tiles.filter(t => t !== joker)
  const kinds: WuhanWinKind[] = []
  const standard = isWuhanStandardWin(tiles, exposed, joker)
  if (standard && wild <= 1) kinds.push('屁胡')
  if (standard) {
    const suits = new Set(natural.filter(t => /^[mps]/.test(t)).map(t => t[0])); const honors = natural.some(t => t === 'green' || t === 'white')
    if (suits.size === 1 && !honors) kinds.push('清一色')
    if (natural.every(t => !/^[mps]/.test(t) || ['2', '5', '8'].includes(t[1]))) kinds.push('将一色')
    if (natural.every(t => t === 'green' || t === 'white')) kinds.push('风一色')
  }
  if (!exposed && tiles.length === 14) { const pairs = [...count(natural).values()].reduce((n, n0) => n + Math.floor(n0 / 2), 0) + Math.floor(wild / 2); if (pairs >= 7) { const quads = [...count(natural).values()].filter(n => n === 4).length; kinds.push(quads > 1 ? '双龙七对' : quads ? '龙七对' : '七对') } }
  return kinds
}

export function wuhanWinPayment(kinds: readonly WuhanWinKind[], selfDraw: boolean, hard: boolean, kongs: readonly WuhanKongKind[]) {
  const big = kinds.filter(k => k !== '屁胡').length
  const base = big ? big * 10 : kinds.includes('屁胡') ? 1 : 0
  const points = base * (hard ? 2 : 1) * (selfDraw ? (big ? 1.5 : 2) : 1) * wuhanKongMultiplier(kongs)
  return capWuhanPayment(points)
}
