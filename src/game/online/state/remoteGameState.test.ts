import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemoteGameState } from './remoteGameState'

afterEach(() => vi.unstubAllGlobals())

describe('remoteGameState', () => {
  it('建立隔离的会话与对局初始状态', () => {
    const first = createRemoteGameState({ guestId: 'guest-1', autoPlay: true })
    const second = createRemoteGameState({ guestId: 'guest-2', autoPlay: false })

    expect(first.playerId.value).toBe('guest-1')
    expect(first.autoPlay.value).toBe(true)
    expect(first.phase.value).toBe('lobby')
    expect(first.turnSeconds.value).toBe(12)

    first.players.push({
      name: '玩家', avatar: '', score: 1000, seat: 0, hand: [], discards: [],
      melds: [], redCount: 0, drawnTileIndex: -1,
    })
    expect(second.players).toHaveLength(0)
  })

  it('接收恢复会话作为状态种子', () => {
    const storedSession = {
      roomId: 'ABC123', rejoinCode: 'CODE', nickname: '莲花',
      playerId: 'guest-1', mode: 'east' as const,
    }
    const state = createRemoteGameState({ storedSession })

    expect(state.storedSession.value).toEqual(storedSession)
  })

  it('微信小游戏缺少 URLSearchParams 时仍可初始化联机状态', () => {
    vi.stubGlobal('location', { search: '?auto=1&from=wechat' })
    vi.stubGlobal('URLSearchParams', undefined)

    expect(createRemoteGameState().autoPlay.value).toBe(true)
  })
})
