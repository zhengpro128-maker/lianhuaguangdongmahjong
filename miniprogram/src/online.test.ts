import { afterEach, expect, it, vi } from 'vitest'
import { createMiniGame } from './game-bridge'
import { installWechatNetwork } from './online-client'

let game: ReturnType<typeof createMiniGame>
afterEach(() => { game?.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('uses native authenticated requests, rotates remote seats and sends player actions', async () => {
  vi.useFakeTimers()
  const root = globalThis as any
  vi.stubGlobal('fetch', root.fetch); vi.stubGlobal('WebSocket', root.WebSocket)
  vi.stubGlobal('window', undefined); vi.stubGlobal('localStorage', undefined)
  const handlers: Record<string, Function> = {}, send = vi.fn(), close = vi.fn()
  const requests: any[] = []
  const wx = { connectSocket: vi.fn(() => ({ onOpen: (f: Function) => handlers.open = f,
    onMessage: (f: Function) => handlers.message = f, onClose: (f: Function) => handlers.close = f,
    onError: (f: Function) => handlers.error = f, send, close })),
    request: (r: any) => {
      requests.push(r)
      const path = new URL(r.url).pathname
      const body = path.endsWith('/join') ? { roomId: 'ABC234', nickname: '小明', rejoinCode: 'secret', seat: 2 }
        : { roomId: 'ABC234', mode: 'east', rulesetId: 'wuhan-huanghuang', creatorSeat: 2, seats: [] }
      r.success({ statusCode: 200, data: body })
    } }
  installWechatNetwork(wx, () => 'session-token')
  game = createMiniGame()
  await game.enterOnline({ nickname: '小明', avatarUrl: 'https://example.com/avatar.png' })
  expect(JSON.parse(requests[0].data)).toMatchObject({ rulesetId: 'wuhan-huanghuang', capacity: 4 })
  expect(requests.every(r => r.header.Authorization === 'Bearer session-token')).toBe(true)
  handlers.open({})
  const receive = (message: any) => handlers.message({ data: JSON.stringify(message) })
  receive({ kind: 'rejoin_ok', roomId: 'ABC234', seat: 2, mode: 'east', nickname: '小明', rejoinCode: 'secret', rejoin: false })
  receive({ kind: 'state_snapshot', roomId: 'ABC234', mode: 'east', rulesetId: 'wuhan-huanghuang', phase: 'drawing', round: 1,
    dealer: 0, honba: 0, wallCount: 80, wall: [], headDrawn: 0, currentPlayer: 2,
    flipTile: null, flipStack: null, openingStack: null, seat: 2, result: null, announcement: null,
    matchFinished: false, lastDiscard: null, winPresentation: null, winningPlayerIndex: -1,
    players: Array.from({ length: 4 }, (_, seat) => ({ seat, name: seat === 2 ? '小明' : `玩家${seat}`, avatar: '',
      score: 1000, hand: seat === 2 ? ['m1', 'm2', 'm3'] : [null, null, null], discards: [], melds: [], redCount: 0, drawnTileIndex: -1 })) })
  receive({ kind: 'turn_request', ctx: { hand: ['m1', 'm2', 'm3'], melds: [], exposedMelds: 0, kongBloom: false, skipDraw: false, afterKong: false } })
  expect(game.snapshot().user).toMatchObject({ name: '小明', seat: 0 })
  expect(game.snapshot().players[1].hand).toEqual([])
  expect(game.discard(0)).toBe(true)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ type: 'discard', handIndex: 0 }) }))
  await game.leaveOnline()
  expect(close).toHaveBeenCalled()
  expect(game.snapshot().gameMode).toBe('local')
})

it('converts native socket errors into a close event so shared reconnect can run', () => {
  vi.useFakeTimers()
  const root = globalThis as any
  vi.stubGlobal('fetch', root.fetch); vi.stubGlobal('WebSocket', root.WebSocket)
  const events: Record<string, Function> = {}
  installWechatNetwork({ request() {}, connectSocket: () => ({
    onOpen: (f: Function) => events.open = f, onMessage: (f: Function) => events.message = f,
    onError: (f: Function) => events.error = f, onClose: (f: Function) => events.close = f, close() {}, send() {},
  }) }, () => 'token')
  const socket = new root.WebSocket('wss://example.com/ws')
  socket.onclose = vi.fn()
  events.error({ errMsg: 'connection refused' })
  events.close({})
  expect(socket.readyState).toBe(3)
  expect(socket.onclose).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
