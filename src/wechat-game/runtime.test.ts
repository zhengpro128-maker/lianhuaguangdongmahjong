import { describe, expect, it, vi } from 'vitest'
import { createWechatGameRuntime } from './runtime'

function createWxHarness(launchQuery: Record<string, string> = {}) {
  const values = new Map<string, unknown>()
  const requests: any[] = []
  const shareAppMessage = vi.fn()
  const wx: any = {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    getLaunchOptionsSync: () => ({ query: launchQuery }),
    onShow: vi.fn(),
    login: ({ success }: any) => success({ code: 'wechat-code' }),
    request: (options: any) => {
      requests.push(options)
      if (options.url.endsWith('/api/auth/wechat')) {
        options.success({ statusCode: 200, data: { playerId: 'wx-player', accessToken: 'access-token' } })
      } else if (options.url.endsWith('/join-by-invite')) {
        options.success({
          statusCode: 200,
          data: {
            roomId: 'ABC123', seat: 1, nickname: '玩家', playerId: 'wx-player',
            rejoinCode: 'rejoin', mode: 'east', rulesetId: 'lotus-classic',
          },
        })
      } else if (options.url.endsWith('/invites')) {
        options.success({ statusCode: 200, data: { roomId: 'ABC123', inviteTicket: 'signed-ticket' } })
      }
    },
    connectSocket: vi.fn(),
    shareAppMessage,
  }
  return { wx, values, requests, shareAppMessage }
}

describe('wechat game runtime', () => {
  it('logs in and joins a room received from a cold launch', async () => {
    const harness = createWxHarness({ room: 'ABC123', ticket: 'signed-ticket' })
    const runtime = createWechatGameRuntime({ wx: harness.wx, apiBase: 'https://api.example.com' })

    await expect(runtime.joinPendingInvite('玩家')).resolves.toEqual(expect.objectContaining({
      roomId: 'ABC123',
      seat: 1,
    }))
    expect(harness.requests[0].data).toEqual({ code: 'wechat-code' })
    expect(harness.requests[1].header.Authorization).toBe('Bearer access-token')
    expect(runtime.getPendingInvite()).toBeNull()
    expect(String(harness.values.get('lgm_session'))).toContain('rejoin')
    expect(harness.values.get('lgm_nickname')).toBe('玩家')
  })

  it('creates a signed invitation before opening the share sheet', async () => {
    const harness = createWxHarness()
    const runtime = createWechatGameRuntime({ wx: harness.wx, apiBase: 'https://api.example.com' })

    await runtime.shareRoom('ABC123')
    expect(harness.shareAppMessage).toHaveBeenCalledWith({
      title: '三缺一，点击加入房间 ABC123',
      query: 'room=ABC123&ticket=signed-ticket',
    })
    expect(harness.requests.at(-1).header.Authorization).toBe('Bearer access-token')
  })
})
