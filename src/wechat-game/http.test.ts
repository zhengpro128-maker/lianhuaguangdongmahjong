import { describe, expect, it, vi } from 'vitest'
import { createWechatHttpClient, WechatRemoteApiError } from './http'

describe('wechat http client', () => {
  it('adds bearer auth and sends JSON data', async () => {
    const request = vi.fn((options) => options.success({ statusCode: 200, data: { ok: true } }))
    const http = createWechatHttpClient({
      wx: { request },
      baseUrl: 'https://api.example.com/',
      getAccessToken: () => 'token',
    })

    await expect(http.request('/api/test', { method: 'POST', body: { room: 'ABC123' } }))
      .resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.example.com/api/test',
      method: 'POST',
      data: { room: 'ABC123' },
      header: expect.objectContaining({ Authorization: 'Bearer token' }),
    }))
  })

  it('preserves backend error codes', async () => {
    const http = createWechatHttpClient({
      wx: { request: (options: any) => options.success({ statusCode: 410, data: { detail: { code: 'INVITE_EXPIRED' } } }) },
      baseUrl: 'https://api.example.com',
    })
    await expect(http.request('/api/test')).rejects.toEqual(
      expect.objectContaining<Partial<WechatRemoteApiError>>({ code: 'INVITE_EXPIRED', status: 410 }),
    )
  })
})
