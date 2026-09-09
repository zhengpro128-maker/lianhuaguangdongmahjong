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
        options.success({
          statusCode: 200,
          data: { playerId: 'wx-player', accessToken: 'access-token', expiresAt: 4600 },
        })
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
    const runtime = createWechatGameRuntime({
      wx: harness.wx, apiBase: 'https://api.example.com', now: () => 1_000_000,
    })

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
    const runtime = createWechatGameRuntime({
      wx: harness.wx, apiBase: 'https://api.example.com', now: () => 1_000_000,
    })

    await runtime.shareRoom('ABC123')
    expect(harness.shareAppMessage).toHaveBeenCalledWith({
      title: '三缺一，点击加入房间 ABC123',
      query: 'room=ABC123&ticket=signed-ticket',
    })
    expect(harness.requests.at(-1).header.Authorization).toBe('Bearer access-token')
  })

  it('restores a non-expired login without calling wx.login', async () => {
    const harness = createWxHarness()
    harness.values.set('lgm_wechat_auth_session', JSON.stringify({
      playerId: 'wechat-existing', accessToken: 'stored-token', expiresAt: 5000,
    }))
    harness.wx.login = vi.fn()
    const runtime = createWechatGameRuntime({
      wx: harness.wx, apiBase: 'https://api.example.com', now: () => 1_000_000,
    })

    await expect(runtime.ensureLogin()).resolves.toEqual({
      playerId: 'wechat-existing', accessToken: 'stored-token', expiresAt: 5000,
    })
    expect(harness.wx.login).not.toHaveBeenCalled()
  })

  it('discards an expired login and obtains a fresh code', async () => {
    const harness = createWxHarness()
    harness.values.set('lgm_wechat_auth_session', JSON.stringify({
      playerId: 'wechat-old', accessToken: 'expired-token', expiresAt: 1001,
    }))
    harness.wx.login = vi.fn(({ success }: any) => success({ code: 'fresh-code' }))
    const runtime = createWechatGameRuntime({
      wx: harness.wx, apiBase: 'https://api.example.com', now: () => 1_000_000,
    })

    await runtime.ensureLogin()
    expect(harness.wx.login).toHaveBeenCalledTimes(1)
    expect(harness.requests[0].data).toEqual({ code: 'fresh-code' })
    expect(runtime.getAuthSession()?.accessToken).toBe('access-token')
  })

  it('refreshes once and retries when the backend rejects a stored token', async () => {
    const harness = createWxHarness()
    harness.values.set('lgm_wechat_auth_session', JSON.stringify({
      playerId: 'wechat-old', accessToken: 'rejected-token', expiresAt: 5000,
    }))
    let inviteAttempts = 0
    harness.wx.request = (options: any) => {
      harness.requests.push(options)
      if (options.url.endsWith('/api/auth/wechat')) {
        options.success({
          statusCode: 200,
          data: { playerId: 'wechat-new', accessToken: 'fresh-token', expiresAt: 6000 },
        })
      } else if (options.url.endsWith('/invites')) {
        inviteAttempts += 1
        if (inviteAttempts === 1) {
          options.success({ statusCode: 401, data: { detail: { code: 'AUTH_REQUIRED' } } })
        } else {
          options.success({ statusCode: 200, data: { roomId: 'ABC123', inviteTicket: 'ticket' } })
        }
      }
    }
    const runtime = createWechatGameRuntime({
      wx: harness.wx, apiBase: 'https://api.example.com', now: () => 1_000_000,
    })

    await runtime.shareRoom('ABC123')
    expect(inviteAttempts).toBe(2)
    expect(runtime.getAuthSession()?.accessToken).toBe('fresh-token')
    expect(harness.requests.at(-1).header.Authorization).toBe('Bearer fresh-token')
  })
})
