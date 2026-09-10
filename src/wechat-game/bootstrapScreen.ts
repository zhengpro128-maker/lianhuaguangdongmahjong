import type { WechatGameRuntime, WechatRoomInfo } from './runtime'
import { errorMessage, type WxGameApi, type WxTouchEvent } from './wx'
import { createWechatNativeTable } from './nativeTable'
import { decodeServerMessage } from '../game/online/protocol/decoder'

interface Button {
  id: 'create' | 'join' | 'refresh' | 'ready' | 'share' | 'start'
  label: string
  x: number
  y: number
  width: number
  height: number
}

interface ScreenState {
  headline: string
  detail: string
  busy: boolean
  room: WechatRoomInfo | null
  socketStatus: string
}

const DEFAULT_NICKNAME = '微信玩家'

function readableError(error: unknown): string {
  const message = errorMessage(error)
  const known: Record<string, string> = {
    WECHAT_AUTH_NOT_CONFIGURED: '服务端尚未配置微信登录',
    WECHAT_CODE_INVALID: '微信登录凭证无效，请重新编译',
    AUTH_REQUIRED: '登录已失效，请重试',
    NETWORK_ERROR: '无法连接云托管服务',
    ROOM_NOT_FOUND: '房间不存在或已经关闭',
    ROOM_LIMIT_REACHED: '服务器房间已满',
    ROOM_INVITE_EXPIRED: '邀请已经过期',
  }
  return known[message] ?? message
}

export function mountWechatBootstrapScreen(options: {
  wx: WxGameApi
  runtime: WechatGameRuntime
  apiBase: string
}) {
  const canvas = options.wx.createCanvas()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('WECHAT_CANVAS_2D_UNAVAILABLE')

  const system = options.wx.getSystemInfoSync()
  const width = Math.max(320, system.screenWidth)
  const height = Math.max(180, system.screenHeight)
  const dpr = Math.min(3, Math.max(1, system.pixelRatio ?? 1))
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  context.scale(dpr, dpr)

  const state: ScreenState = {
    headline: '正在登录微信',
    detail: '正在连接云托管服务...',
    busy: true,
    room: null,
    socketStatus: '未连接',
  }
  let buttons: Button[] = []
  let socket: ReturnType<WechatGameRuntime['socketFactory']> | null = null
  const table = createWechatNativeTable({
    wx: options.wx,
    context,
    width,
    height,
    dpr,
    send(message) {
      if (!socket || socket.readyState !== 1) return
      socket.send(JSON.stringify(message))
    },
  })

  function drawText(text: string, x: number, y: number, maxWidth: number) {
    context.fillText(text.length > 54 ? `${text.slice(0, 51)}...` : text, x, y, maxWidth)
  }

  function drawButton(button: Button) {
    context.fillStyle = state.busy ? '#52615b' : '#caa24c'
    context.fillRect(button.x, button.y, button.width, button.height)
    context.fillStyle = state.busy ? '#b8c0bd' : '#102019'
    context.font = '700 16px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2)
  }

  function render() {
    if (table.active()) {
      table.render()
      return
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = '#071711'
    context.fillRect(0, 0, width, height)
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.fillStyle = '#d7b85e'
    context.font = '700 14px sans-serif'
    context.fillText('微信小游戏联机调试', 30, 38)
    context.fillStyle = '#f1e7cd'
    context.font = '700 30px sans-serif'
    context.fillText(state.headline, 30, 82)
    context.fillStyle = '#9fb2a8'
    context.font = '14px sans-serif'
    drawText(state.detail, 30, 112, width - 60)

    context.fillStyle = '#10271e'
    context.fillRect(30, 138, width - 60, 74)
    context.fillStyle = '#b9c9c0'
    context.font = '13px sans-serif'
    drawText(`API: ${options.apiBase}`, 46, 166, width - 92)
    drawText(`WebSocket: ${state.socketStatus}`, 46, 192, width - 92)

    const actions: Array<{ id: Button['id']; label: string }> = []
    if (state.room) {
      actions.push(
        { id: 'refresh', label: '刷新房间' },
        { id: 'ready', label: '准备' },
        { id: 'share', label: '分享好友' },
      )
      const session = options.runtime.sessionStore.loadSession()
      if (session?.seat === state.room.creatorSeat) actions.push({ id: 'start', label: '开始对局' })
    } else if (options.runtime.getPendingInvite()) {
      actions.push({ id: 'join', label: '加入邀请房间' })
    } else {
      actions.push({ id: 'create', label: '创建测试房间' })
    }

    const gap = 12
    const buttonWidth = Math.min(170, (width - 60 - gap * (actions.length - 1)) / actions.length)
    const totalWidth = buttonWidth * actions.length + gap * (actions.length - 1)
    const startX = (width - totalWidth) / 2
    buttons = actions.map((action, index) => ({
      ...action,
      x: startX + index * (buttonWidth + gap),
      y: Math.min(height - 66, 236),
      width: buttonWidth,
      height: 44,
    }))
    buttons.forEach(drawButton)
  }

  function setStatus(headline: string, detail: string, busy = false) {
    state.headline = headline
    state.detail = detail
    state.busy = busy
    render()
  }

  function attachSocket(nextSocket: ReturnType<WechatGameRuntime['socketFactory']>) {
    socket?.close()
    socket = nextSocket
    state.socketStatus = '连接中'
    socket.onopen = () => {
      state.socketStatus = '已连接'
      render()
    }
    socket.onerror = (error) => {
      state.socketStatus = `连接错误：${readableError(error)}`
      render()
    }
    socket.onclose = () => {
      state.socketStatus = '已断开'
      render()
    }
    socket.onmessage = (event) => {
      try {
        const message = decodeServerMessage(JSON.parse(event.data))
        if (!message) return
        if (message.kind === 'state_snapshot') {
          table.receive(message)
          return
        }
        if (message.kind === 'turn_request' || message.kind === 'claim_request' || message.kind === 'rob_kong_request') {
          table.receiveMessage(message)
          return
        }
        if (message.kind === 'error' || message.kind === 'rejoin_err') {
          table.showDetail(`服务器提示：${readableError(message.code)}`)
        }
      } catch {
        table.showDetail('服务端消息解析失败')
      }
    }
  }

  async function loadRoom(connect = false) {
    state.room = await options.runtime.getCurrentRoom()
    if (!state.room) {
      setStatus('登录成功', options.runtime.getPendingInvite() ? '检测到好友邀请' : '可以创建测试房间')
      return
    }
    const occupied = state.room.seats.filter(Boolean).length
    setStatus(`房间 ${state.room.roomId}`, `${occupied}/${state.room.capacity} 位玩家，状态：${state.room.status}`)
    if (connect) attachSocket(await options.runtime.connectCurrentRoom())
  }

  async function runAction(id: Button['id']) {
    if (state.busy) return
    setStatus('处理中', '请稍候...', true)
    try {
      if (id === 'create') {
        await options.runtime.createRoom({ nickname: DEFAULT_NICKNAME })
        await loadRoom(true)
      } else if (id === 'join') {
        await options.runtime.joinPendingInvite(DEFAULT_NICKNAME)
        await loadRoom(true)
      } else if (id === 'refresh') {
        await loadRoom()
      } else if (id === 'ready') {
        await options.runtime.setReady(true)
        await loadRoom()
      } else if (id === 'share' && state.room) {
        await options.runtime.shareRoom(state.room.roomId)
        await loadRoom()
      } else if (id === 'start') {
        await options.runtime.startCurrentRoom()
        await loadRoom()
      }
    } catch (error) {
      setStatus('操作失败', readableError(error))
    }
  }

  function handleTouch(event: WxTouchEvent) {
    if (table.active()) {
      table.handleTouch(event)
      return
    }
    const touch = event.changedTouches?.[0]
    const x = touch?.clientX ?? touch?.pageX
    const y = touch?.clientY ?? touch?.pageY
    if (x === undefined || y === undefined) return
    const button = buttons.find((item) => (
      x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height
    ))
    if (button) void runAction(button.id)
  }

  options.wx.onTouchEnd(handleTouch)
  options.wx.showShareMenu?.({ withShareTicket: true, menus: ['shareAppMessage'] })
  options.runtime.onRoomInvite(() => {
    if (!state.room) setStatus('收到好友邀请', '点击下方按钮加入房间')
  })
  render()

  const ready = (async () => {
    try {
      await options.runtime.ensureLogin()
      await loadRoom(true)
    } catch (error) {
      setStatus('启动失败', readableError(error))
    }
  })()

  return { ready, render, getState: () => ({ ...state }), runAction }
}
