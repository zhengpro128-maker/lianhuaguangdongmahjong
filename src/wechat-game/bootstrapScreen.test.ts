import { describe, expect, it, vi } from 'vitest'
import { mountWechatBootstrapScreen } from './bootstrapScreen'

function harness(loginError?: Error) {
  const context = {
    scale: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
  }
  let touch: ((event: unknown) => void) | undefined
  const wx = {
    createCanvas: () => ({ width: 0, height: 0, getContext: () => context }),
    getSystemInfoSync: () => ({ screenWidth: 667, screenHeight: 375, pixelRatio: 2 }),
    onTouchEnd: (callback: (event: unknown) => void) => { touch = callback },
    showShareMenu: vi.fn(),
  } as any
  let room: any = null
  const socket: any = { close: vi.fn(), send: vi.fn(), readyState: 0 }
  const runtime = {
    ensureLogin: loginError ? vi.fn().mockRejectedValue(loginError) : vi.fn().mockResolvedValue({}),
    getCurrentRoom: vi.fn(async () => room),
    createRoom: vi.fn(async () => {
      room = {
        roomId: 'ABC123', capacity: 4, status: 'lobby', creatorSeat: 0,
        seats: [{ seat: 0, nickname: '微信玩家' }, null, null, null],
      }
    }),
    joinPendingInvite: vi.fn(), setReady: vi.fn(), shareRoom: vi.fn(), startCurrentRoom: vi.fn(),
    connectCurrentRoom: vi.fn(async () => socket),
    getPendingInvite: vi.fn(() => null),
    onRoomInvite: vi.fn(() => vi.fn()),
    sessionStore: { loadSession: vi.fn(() => ({ seat: 0 })) },
    socketFactory: vi.fn(),
  } as any
  return { wx, runtime, socket, context, getTouch: () => touch }
}

describe('wechat bootstrap screen', () => {
  it('shows login success, creates a room and attaches its socket', async () => {
    const value = harness()
    const screen = mountWechatBootstrapScreen({
      wx: value.wx, runtime: value.runtime, apiBase: 'https://api.example.com',
    })
    await screen.ready
    expect(screen.getState().headline).toBe('登录成功')
    expect(value.getTouch()).toBeTypeOf('function')
    expect(value.wx.showShareMenu).toHaveBeenCalled()

    await screen.runAction('create')
    expect(value.runtime.createRoom).toHaveBeenCalledWith({
      nickname: '微信玩家', mode: 'east', rulesetId: 'lotus-classic',
    })
    expect(screen.getState().headline).toBe('房间 ABC123')
    expect(screen.getState().socketStatus).toBe('连接中')
    value.socket.onopen()
    expect(screen.getState().socketStatus).toBe('已连接')
  })

  it('renders a readable startup error instead of staying blank', async () => {
    const value = harness(new Error('WECHAT_AUTH_NOT_CONFIGURED'))
    const screen = mountWechatBootstrapScreen({
      wx: value.wx, runtime: value.runtime, apiBase: 'https://api.example.com',
    })
    await screen.ready
    expect(screen.getState()).toEqual(expect.objectContaining({
      headline: '启动失败', detail: '服务端尚未配置微信登录', busy: false,
    }))
  })
})
