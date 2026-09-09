import type { GamePlayer, TileType } from '../../core/contracts/types'
import { sortTilesWithJokers } from '../../core/rules/tiles'
import { createTileFlowExecutor, takeStackTailTile } from '../../shared/runtime/tileFlowExecutor'
import type { FollowDealerTracker } from '../../shared/runtime/followDealer'
import type { LotusController } from '../lotus/lotusControllers'
import type { WuhanGameState } from './wuhanState'
import type { createWuhanTurnOrchestrator } from './wuhanTurnOrchestrator'
import { WUHAN_DRAW_STOP_COUNT, WUHAN_WALL_SIZE } from './ruleProfile'

interface Options {
  state: WuhanGameState
  controllers: LotusController[]
  getTurnOrchestrator(): ReturnType<typeof createWuhanTurnOrchestrator>
  endDraw(): unknown
  playSound(name: string, volume?: number): unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  shouldAnnounceDiscard?: (playerIndex: number, player: GamePlayer) => boolean
  later(callback: () => void, delay: number): number
  stopCountdown(): void
  followDealer?: FollowDealerTracker
}

export function createWuhanTileFlow(options: Options) {
  const common = createTileFlowExecutor({
    ...options,
    sortHand: (hand) => sortTilesWithJokers(hand, options.state.jokerTiles.value),
    getTurnFlow: options.getTurnOrchestrator,
    initialWallSize: WUHAN_WALL_SIZE,
    minimumWallCount: WUHAN_DRAW_STOP_COUNT,
    takeTailTile: (wall, headDrawn) => wall.length <= WUHAN_DRAW_STOP_COUNT
      ? null
      : takeStackTailTile(wall, headDrawn, WUHAN_WALL_SIZE),
    async handleSpecialDraw(playerIndex, tile, drawAgain) {
      if (tile !== 'red') return undefined
      const player = options.state.players[playerIndex]
      player.redCount += 1
      player.melds.push({ type: 'flower', tile: 'red', tiles: ['red'] })
      player.drawnTileIndex = -1
      options.getTurnOrchestrator().showRedKong(playerIndex, player.melds.length - 1)
      options.playSound('gang.mp3')
      return drawAgain()
    },
  })

  function takeTile(fromTail = false): TileType | null {
    if (options.state.wall.value.length <= WUHAN_DRAW_STOP_COUNT) return null
    return common.takeTile(fromTail)
  }

  async function drawFor(playerIndex: number, fromTail = false) {
    if (options.state.wall.value.length <= WUHAN_DRAW_STOP_COUNT) {
      options.endDraw()
      return false
    }
    return common.drawFor(playerIndex, fromTail)
  }

  return { ...common, takeTile, drawFor }
}
