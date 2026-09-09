import { ref } from 'vue'
import type { TileType } from '../../core/contracts/types'
import { createLocalGameState } from '../../core/local/localGameState'

export interface WuhanEndGameOptions {
  winTile?: TileType
  winHand?: TileType[]
  selfDraw?: boolean
  kongBloom?: boolean
  robbedKong?: boolean
  robbedKongPlayerIndex?: number
  sourceFrom?: number
  tianhu?: boolean
  dihu?: boolean
}

export function createWuhanGameState() {
  return {
    ...createLocalGameState(),
    flipTile: ref<TileType | null>(null),
    jokerTiles: ref<TileType[]>([]),
    wildcardTiles: ref<TileType[]>([]),
    wallBreakIndex: ref(0),
    flipStack: ref<number | null>(null),
    flipSeat: ref<number | null>(null),
    firstDice: ref<[number, number] | null>(null),
    secondDice: ref<[number, number] | null>(null),
    roundFirstDiscard: ref(true),
  }
}

export type WuhanGameState = ReturnType<typeof createWuhanGameState>
