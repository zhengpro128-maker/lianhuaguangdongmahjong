import { afterEach, expect, it, vi } from 'vitest'
import { normalizeApiBase } from '../../src/game/online/api/httpClient'
import { createWechatAuth } from './wechat-auth'
afterEach(() => vi.unstubAllEnvs())
it('retains server identity and exposes a stable display number after login', async () => {
  vi.stubEnv('VITE_API_BASE', 'https://example.com')
  const wx = { login: ({ success }) => success({ code: 'test-code' }),
    request: ({ success }) => success({ statusCode: 200, data: { sessionToken: 'token',
      account: { id: 'server-openid', displayName: '小明', avatarUrl: 'https://example.com/avatar.png' } } }),
    setStorageSync: vi.fn() }
  const auth = createWechatAuth(wx)
  const user = await auth.authorize({ nickName: '小明', avatarUrl: 'https://example.com/avatar.png' })
  expect(user.nickname).toBe('小明')
  expect(user.displayId).toMatch(/^[0-9A-F]{8}$/)
  expect((await auth.authorize({ nickName: '小明', avatarUrl: 'https://example.com/avatar.png' })).displayId).toBe(user.displayId)
  expect(wx.setStorageSync.mock.calls[0][1]).not.toHaveProperty('sessionToken')
})
it('does not silently authenticate a failed server exchange', async () => {
  vi.stubEnv('VITE_API_BASE', 'https://example.com')
  const auth = createWechatAuth({ login: ({ success }) => success({ code: 'bad' }),
    request: ({ success }) => success({ statusCode: 401, data: { detail: { code: 'WECHAT_LOGIN_FAILED' } } }) })
  await expect(auth.authorize({ nickName: '小明', avatarUrl: 'https://example.com/a.png' })).rejects.toThrow('WECHAT_LOGIN_FAILED')
  expect(auth.identity).toBeNull()
})

it('removes trailing slashes from a configured API base', () => {
  expect(normalizeApiBase('https://example.com/')).toBe('https://example.com')
  expect(normalizeApiBase('https://example.com///')).toBe('https://example.com')
})

it('does not call login or establish an identity without authorized profile data', async () => {
  const login = vi.fn(), request = vi.fn()
  const auth = createWechatAuth({ login, request })
  await expect(auth.authorize()).rejects.toThrow('微信未返回完整头像昵称')
  await expect(auth.authorize({ nickName: '微信玩家' })).rejects.toThrow('微信未返回完整头像昵称')
  expect(login).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
  expect(auth.identity).toBeNull()
})
