import { describe, expect, it, vi } from 'vitest'
import { createWechatSocketFactory } from './socket'

describe('wechat socket adapter', () => {
  it('maps SocketTask events to the browser-compatible socket contract', () => {
    const callbacks: Record<string, (...args: any[]) => void> = {}
    const task = {
      onOpen: (callback: () => void) => { callbacks.open = callback },
      onMessage: (callback: (event: { data: string }) => void) => { callbacks.message = callback },
      onClose: (callback: () => void) => { callbacks.close = callback },
      onError: (callback: (error: unknown) => void) => { callbacks.error = callback },
      send: vi.fn(),
      close: vi.fn(),
    }
    const connectSocket = vi.fn(() => task)
    const socket = createWechatSocketFactory({ connectSocket }, () => 'access-token')('wss://api.example.com/ws')
    const onMessage = vi.fn()
    socket.onmessage = onMessage

    expect(socket.readyState).toBe(0)
    callbacks.open()
    expect(socket.readyState).toBe(1)
    socket.send('{"kind":"ping"}')
    callbacks.message({ data: '{"kind":"pong"}' })

    expect(connectSocket).toHaveBeenCalledWith({
      url: 'wss://api.example.com/ws',
      header: { Authorization: 'Bearer access-token' },
    })
    expect(task.send).toHaveBeenCalledWith(expect.objectContaining({ data: '{"kind":"ping"}' }))
    expect(onMessage).toHaveBeenCalledWith({ data: '{"kind":"pong"}' })

    callbacks.close()
    expect(socket.readyState).toBe(3)
  })
})
