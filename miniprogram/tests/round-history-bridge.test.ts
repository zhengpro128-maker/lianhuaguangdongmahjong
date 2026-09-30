import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMiniGame } from '../src/game-bridge'
import { installWechatNetwork } from '../src/online-client'
import type { MatchRoundRecord } from '../../src/game/shared/roundHistory'

let game: ReturnType<typeof createMiniGame>
let receive: (message: unknown) => void

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('localStorage', undefined)
  vi.stubGlobal('fetch', globalThis.fetch)
  vi.stubGlobal('WebSocket', globalThis.WebSocket)
  const handlers: Record<string, Function> = {}
  installWechatNetwork({
    request: (request: any) => request.success({ statusCode: 200, data:
      new URL(request.url).pathname.endsWith('/join')
        ? { roomId: 'ABC123', nickname: '本家', rejoinCode: 'secret', seat: 2 }
        : { roomId: 'ABC123', mode: 'rounds4', rulesetId: 'wuhan-huanghuang', creatorSeat: 2, seats: [] },
    }),
    connectSocket: () => ({ onOpen: (fn: Function) => handlers.open = fn,
      onMessage: (fn: Function) => handlers.message = fn, onClose: (fn: Function) => handlers.close = fn,
      onError: (fn: Function) => handlers.error = fn, send() {}, close() {},
    }),
  }, () => 'session-token')
  game = createMiniGame()
  await game.enterOnline({ nickname: '本家', avatarUrl: '' }, undefined, 'rounds4')
  handlers.open({})
  receive = (message) => handlers.message({ data: JSON.stringify(message) })
  receive({ kind: 'rejoin_ok', roomId: 'ABC123', seat: 2, mode: 'rounds4',
    nickname: '本家', rejoinCode: 'secret', rejoin: false })
})

afterEach(() => {
  game?.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function record(): MatchRoundRecord {
  return {
    id: 'ABC123:1:0', round: 1, dealer: 1, honba: 0,
    winnerIndex: 2, winner: '原本家', winType: 'self-draw',
    scoreChanges: Array.from({ length: 4 }, (_, playerIndex) => ({
      playerIndex, name: playerIndex === 2 ? '原本家' : `原玩家${playerIndex}`,
      avatar: `https://example.com/history/${playerIndex}.png`,
      score: playerIndex === 2 ? 1300 : 900, delta: playerIndex === 2 ? 300 : -100,
    })),
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'state_snapshot', roomId: 'ABC123', mode: 'rounds4', rulesetId: 'wuhan-huanghuang',
    phase: 'drawing', round: 2, dealer: 1, honba: 0, wallCount: 80, wall: [], headDrawn: 40,
    currentPlayer: 1, seat: 2, flipTile: null, flipStack: null, openingStack: null,
    players: Array.from({ length: 4 }, (_, seat) => ({
      seat, name: `新玩家${seat}`, avatar: 'https://example.com/current.png', score: 1000,
      hand: [], discards: [], melds: [], redCount: 0, drawnTileIndex: -1,
    })),
    result: null, announcement: null, matchFinished: false, lastDiscard: null,
    winPresentation: null, winningPlayerIndex: -1, ...overrides,
  }
}

it('exposes backend history availability and keeps immutable recorded identities after result is cleared', () => {
  receive(snapshot())
  expect(game.snapshot()).toMatchObject({ roundHistoryAvailable: false, roundHistory: [] })
  receive(snapshot({ roundHistory: [] }))
  expect(game.snapshot()).toMatchObject({ roundHistoryAvailable: true, roundHistory: [] })
  receive(snapshot({ roundHistory: [record()] }))
  const state = game.snapshot()
  expect(state.result).toBeNull()
  expect(state.roundHistory[0]).toMatchObject({ dealer: 3, winnerIndex: 0 })
  expect(state.players[0].name).toBe('新玩家2')
  expect(state.roundHistory[0].scoreChanges[0]).toMatchObject({
    name: '原本家', avatar: 'https://example.com/history/2.png', delta: 300,
  })
  state.roundHistory[0].scoreChanges[0].name = 'changed outside the bridge'
  expect(game.snapshot().roundHistory[0].scoreChanges[0].name).toBe('原本家')
  receive(snapshot({ roundHistory: [record()] }))
  expect(game.snapshot().roundHistory).toHaveLength(1)
})

it('keeps completed-match history and clears it when returning to a new local session', () => {
  receive(snapshot({ roundHistory: [record()] }))
  receive({ kind: 'match_finished', roomId: 'ABC123', mode: 'rounds4', finalScores: [] })
  expect(game.snapshot()).toMatchObject({ phase: 'finished', roundHistoryAvailable: true })
  expect(game.snapshot().roundHistory).toHaveLength(1)
  game.backToLobby()
  expect(game.snapshot()).toMatchObject({ gameMode: 'local', roundHistoryAvailable: false, roundHistory: [] })
})
