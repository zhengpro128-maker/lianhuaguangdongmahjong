import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMiniGame, tileAssetPath } from './game-bridge'
import { installMiniGamePlatform } from './platform'

const games: ReturnType<typeof createMiniGame>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('localStorage', undefined)
  let seed = 72391
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  })
})
afterEach(() => {
  games.splice(0).forEach(game => game.dispose())
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

function game(options: Parameters<typeof createMiniGame>[0] = {}) {
  const result = createMiniGame(options)
  games.push(result)
  return result
}
async function until(test: () => boolean, limit = 30_000) {
  for (let elapsed = 0; elapsed < limit && !test(); elapsed += 100) await vi.advanceTimersByTimeAsync(100)
  expect(test()).toBe(true)
}
async function open(bridge: ReturnType<typeof createMiniGame>) {
  const opening = bridge.start({ ruleVariant: 'wuhan-huanghuang', matchType: 'east' })
  await until(() => bridge.snapshot().isUserTurn)
  await opening
}

describe('mini game shared Wuhan bridge', () => {
  it('starts the actual 120-tile engine, exposes isolated native tile snapshots and routes one discard', async () => {
    const onChange = vi.fn()
    const bridge = game({ onChange })
    expect(bridge.snapshot()).toMatchObject({ phase: 'lobby', secondDice: [], wallTotal: 120 })
    await open(bridge)
    const state = bridge.snapshot()
    expect(state.players).toHaveLength(4)
    expect(state.user?.hand).toHaveLength(14)
    expect(state.jokerTiles).toHaveLength(1)
    expect(state.flipTile).toBeTruthy()
    expect(state.players[0].avatar).toBe('assets/avatars/lotus.png')
    expect(state.wall.length + state.players.reduce((n, p) => n + p.hand.length + p.discards.length + p.melds.flatMap(m => m.tiles).length, 0)).toBe(120)
    state.players[0].hand.length = 0
    expect(bridge.snapshot().players[0].hand).toHaveLength(14)
    expect(bridge.action('hu')).toBe(false)
    expect(bridge.selectTile(-1)).toBe(false)
    const hand = bridge.snapshot().user!.hand
    const index = hand.findIndex(tile => tile !== 'red' && !bridge.snapshot().jokerTiles.includes(tile))
    const tile = hand[index]
    expect(bridge.selectTile(index)).toBe(true)
    expect(bridge.snapshot().selectedIndex).toBe(index)
    expect(bridge.discard(index)).toBe(true)
    // A double tap cannot cause a second discard before Vue flushes the turn.
    expect(bridge.discard(index)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(bridge.snapshot().lastDiscard).toMatchObject({ from: 0, tile })
    expect(bridge.snapshot().user!.hand).toHaveLength(13)
    expect(onChange).toHaveBeenCalled()
    expect(tileAssetPath('m3')).toBe('assets/tiles/3m.png')
    expect(tileAssetPath('white')).toBe('assets/tiles/7z.png')
  })

  it('stops canceled opening promises, old callbacks and timers on restart and disposal', async () => {
    const onChange = vi.fn()
    const bridge = game({ onChange })
    const firstStart = bridge.start()
    await vi.advanceTimersByTimeAsync(200)
    const replacement = bridge.start({ matchType: 'hanchan' })
    await firstStart
    await until(() => bridge.snapshot().isUserTurn)
    await replacement
    expect(bridge.snapshot()).toMatchObject({ matchType: 'rounds8', matchName: '8 局', round: 1, roundLabel: '第 1 局' })
    expect(bridge.snapshot().players).toHaveLength(4)
    bridge.backToLobby()
    const state = bridge.snapshot()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bridge.snapshot()).toEqual(state)
    expect(state.phase).toBe('lobby')
    bridge.dispose()
    const calls = onChange.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onChange).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('routes red and joker tile discards through the original single-tile kong and replacement draw', async () => {
    const bridge = game()
    const verified = new Set<string>()
    for (let attempt = 0; attempt < 12 && verified.size < 2; attempt += 1) {
      await open(bridge)
      const state = bridge.snapshot(), user = state.user!
      const index = user.hand.findIndex(tile => tile === 'red' && !verified.has('red')
        || state.jokerTiles.includes(tile) && !verified.has('joker'))
      if (index < 0) continue
      const tile = user.hand[index], kind = tile === 'red' ? 'red' : 'joker'
      const beforeWall = state.wallCount, beforeDiscards = user.discards.length
      expect(bridge.discard(index)).toBe(true)
      await until(() => bridge.snapshot().user!.melds.some(meld => meld.specialKong === kind))
      await until(() => bridge.snapshot().isUserTurn && bridge.snapshot().wallCount < beforeWall)
      const after = bridge.snapshot().user!
      expect(after.melds).toContainEqual(expect.objectContaining({ type: 'flower', tile, tiles: [tile], specialKong: kind }))
      expect(after.discards).toHaveLength(beforeDiscards)
      expect(after.hand).toHaveLength(14)
      verified.add(kind)
    }
    expect([...verified].sort()).toEqual(['joker', 'red'])
  })

  it('suspends human autoplay and countdown while WeChat is hidden', async () => {
    const bridge = game({ countdownEnabled: true })
    await open(bridge)
    bridge.setAutoPlay(true)
    bridge.pause()
    const hand = bridge.snapshot().user!.hand
    const remaining = bridge.snapshot().turnSeconds
    await vi.advanceTimersByTimeAsync(40_000)
    expect(bridge.snapshot().user!.hand).toEqual(hand)
    expect(bridge.snapshot().turnSeconds).toBe(remaining)
    expect(bridge.snapshot().actions).toEqual([])
    expect(bridge.discard(0)).toBe(false)
    bridge.resume()
    await until(() => bridge.snapshot().user!.hand.length !== hand.length || bridge.snapshot().user!.discards.length > 0)
  })

  it('plays through browser settlement with zero-sum scoring and continues the match', async () => {
    const bridge = game()
    await open(bridge)
    bridge.setAutoPlay(true)
    const events = new Set<string>()
    for (let step = 0; step < 4000 && bridge.snapshot().phase !== 'settled'; step += 1) {
      await vi.advanceTimersByTimeAsync(1000)
      const event = bridge.snapshot().tableActionEvent
      if (event) events.add(event.type)
    }
    const settled = bridge.snapshot()
    expect(settled.phase).toBe('settled')
    expect(settled.result).toBeTruthy()
    expect(settled.players.reduce((total, player) => total + player.score, 0)).toBe(4000)
    const inPlay = settled.wall.length + settled.players.reduce((total, player) => total + player.hand.length + player.discards.length
      + player.melds.reduce((n, meld) => n + meld.tiles.length, 0), 0) + (settled.winPresentation?.discardWin ? 1 : 0)
    expect(inPlay).toBe(120)
    expect(events.size).toBeGreaterThan(0)
    bridge.setAutoPlay(false)
    bridge.nextRound()
    expect(bridge.snapshot().phase).toBe('dealing')
    expect(bridge.snapshot().result).toBeNull()
  }, 60_000)

  it('rejects unsupported rules and online modes before disrupting the current game', async () => {
    const bridge = game()
    await expect(bridge.start({ ruleVariant: 'lotus-classic' })).rejects.toThrow('仅支持武汉晃晃')
    await expect(bridge.start({ gameMode: 'remote' })).rejects.toThrow('仅支持单机')
    expect(bridge.snapshot().phase).toBe('lobby')
  })
})

describe('mini game platform', () => {
  it('adds timer/storage services without claiming the first WeChat screen canvas', () => {
    const values = new Map<string, string>()
    const wxApi = { createCanvas: vi.fn(), getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: string) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) }
    const installed = installMiniGamePlatform(wxApi)
    installed.storage.setItem('test', 'saved')
    expect(installed.storage.getItem('test')).toBe('saved')
    installed.storage.removeItem('test')
    expect(installed.storage.getItem('test')).toBeNull()
    expect(wxApi.createCanvas).not.toHaveBeenCalled()
    expect(installed.window.setTimeout).toBeTypeOf('function')
  })
})
