import type { WechatGameRuntime, WechatRoomInfo } from './runtime'
import { errorMessage, type WxGameApi, type WxTouchEvent } from './wx'
import { createWechatNativeTable } from './nativeTable'
import { decodeServerMessage } from '../game/online/protocol/decoder'

interface Button {
  id: 'create' | 'join' | 'refresh' | 'ready' | 'share' | 'start' | 'nickname' | 'mode' | 'rules' | 'join-code' | 'leave'
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
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let allowReconnect = false
  let nickname = options.runtime.sessionStore.loadSession()?.nickname || DEFAULT_NICKNAME
  let joinCode = ''
  let mode: 'east' | 'hanchan' = 'east'
  let rulesetId: 'lotus-classic' | 'lotus-legacy' = 'lotus-classic'
  const openingDoneRounds = new Set<number>()
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
    onReturnToRoom() { void loadRoom() },
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
    context.fillText('四人在线麻将', 30, 38)
    context.fillStyle = '#f1e7cd'
    context.font = '700 30px sans-serif'
    context.fillText(state.headline, 30, 82)
    context.fillStyle = '#9fb2a8'
    context.font = '14px sans-serif'
    drawText(state.detail, 30, 112, width - 60)

    context.fillStyle = '#10271e'
    context.fillRect(30, 128, width - 60, 78)
    context.fillStyle = '#b9c9c0'
    context.font = '13px sans-serif'
    if (state.room) {
      drawText(`${state.room.mode === 'east' ? '东风场' : '半庄场'} · ${state.room.rulesetId === 'lotus-legacy' ? '莲花麻将' : '莲花广麻'} · ${state.socketStatus}`, 46, 150, width - 92)
      const seatWidth = (width - 104) / 4
      state.room.seats.forEach((seat, index) => {
        const x = 46 + index * seatWidth
        context.fillStyle = seat?.ready ? '#8ed08e' : '#e8efe9'
        context.font = '700 12px sans-serif'
        drawText(seat ? `${index + 1}. ${seat.nickname}` : `${index + 1}. 等待加入`, x, 177, seatWidth - 6)
        if (seat) {
          context.fillStyle = seat.ready ? '#70c979' : '#c7a56b'
          context.font = '11px sans-serif'
          drawText(seat.ready ? '已准备' : '未准备', x, 195, seatWidth - 6)
        }
      })
    } else {
      drawText(`昵称：${nickname}`, 46, 156, width - 92)
      drawText(`${mode === 'east' ? '东风场' : '半庄场'} · ${rulesetId === 'lotus-classic' ? '莲花广麻' : '莲花麻将'} · 四人对局`, 46, 184, width - 92)
    }

    const actions: Array<{ id: Button['id']; label: string }> = []
    if (state.room) {
      actions.push(
        { id: 'refresh', label: '刷新房间' },
        { id: 'ready', label: state.room.seats.find((seat) => seat?.seat === options.runtime.sessionStore.loadSession()?.seat)?.ready ? '取消准备' : '准备' },
        { id: 'share', label: '分享好友' },
        { id: 'leave', label: '离开房间' },
      )
      const session = options.runtime.sessionStore.loadSession()
      if (session?.seat === state.room.creatorSeat) actions.push({ id: 'start', label: '开始对局' })
    } else if (options.runtime.getPendingInvite()) {
      actions.push({ id: 'join', label: '加入邀请房间' })
    } else {
      actions.push(
        { id: 'nickname', label: `昵称：${nickname}` },
        { id: 'mode', label: mode === 'east' ? '东风场' : '半庄场' },
        { id: 'rules', label: rulesetId === 'lotus-classic' ? '莲花广麻' : '莲花麻将' },
        { id: 'create', label: '创建房间' },
        { id: 'join-code', label: '输入房间码' },
      )
    }

    const gap = 12
    const columns = Math.min(3, actions.length)
    const buttonWidth = Math.min(170, (width - 60 - gap * (columns - 1)) / columns)
    buttons = actions.map((action, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const rowCount = Math.min(columns, actions.length - row * columns)
      const rowWidth = buttonWidth * rowCount + gap * (rowCount - 1)
      return {
        ...action,
        x: (width - rowWidth) / 2 + column * (buttonWidth + gap),
        y: Math.min(height - 66, 224 + row * 52),
        width: buttonWidth,
        height: 44,
      }
    })
    buttons.forEach(drawButton)
  }

  function setStatus(headline: string, detail: string, busy = false) {
    state.headline = headline
    state.detail = detail
    state.busy = busy
    render()
  }

  function scheduleReconnect() {
    if (!allowReconnect || reconnectTimer || !options.runtime.sessionStore.loadSession()) return
    const delay = Math.min(8000, 500 * 2 ** reconnectAttempt++)
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      try {
        state.socketStatus = '正在重连'
        render()
        attachSocket(await options.runtime.connectCurrentRoom())
      } catch (error) {
        state.socketStatus = `重连失败：${readableError(error)}`
        render()
        scheduleReconnect()
      }
    }, delay)
  }

  function attachSocket(nextSocket: ReturnType<WechatGameRuntime['socketFactory']>) {
    socket?.close()
    socket = nextSocket
    state.socketStatus = '连接中'
    socket.onopen = () => {
      reconnectAttempt = 0
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
      scheduleReconnect()
    }
    socket.onmessage = (event) => {
      try {
        const message = decodeServerMessage(JSON.parse(event.data))
        if (!message) {
          table.showDetail('收到无法识别的服务端消息')
          return
        }
        if (message.kind === 'state_snapshot') {
          // 房间大厅仍由准备页呈现，只有真正开局后才切到原生牌桌。
          if (message.phase === 'lobby') return
          table.receive(message)
          if ((message.phase === 'opening' || message.phase === 'dealing') && !openingDoneRounds.has(message.round)) {
            openingDoneRounds.add(message.round)
            setTimeout(() => {
              if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'opening_done', round: message.round }))
            }, 900)
          }
          return
        }
        if (message.kind === 'room_closed') {
          allowReconnect = false
          options.runtime.sessionStore.clearSession()
          table.reset()
          state.room = null
          state.socketStatus = '已断开'
          setStatus('房间已关闭', '可重新创建房间，或输入好友房间码')
          return
        }
        if (message.kind === 'rejoin_err') {
          allowReconnect = false
          table.showDetail(`连接失败：${readableError(message.code)}`)
          return
        }
        if (message.kind === 'rejoin_ok' && message.theme) table.setTheme(message.theme)
        table.receiveMessage(message)
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
    if (connect) {
      allowReconnect = true
      attachSocket(await options.runtime.connectCurrentRoom())
    }
  }

  function requestKeyboard(defaultValue: string, maxLength: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!options.wx.showKeyboard || !options.wx.onKeyboardConfirm) {
        reject(new Error('当前基础库不支持键盘输入'))
        return
      }
      const confirm = (event: { value: string }) => {
        options.wx.offKeyboardConfirm?.(confirm)
        options.wx.hideKeyboard?.()
        resolve(event.value)
      }
      options.wx.onKeyboardConfirm(confirm)
      options.wx.showKeyboard({
        defaultValue,
        maxLength,
        confirmType: 'done',
        fail(error) {
          options.wx.offKeyboardConfirm?.(confirm)
          reject(error)
        },
      })
    })
  }

  async function runAction(id: Button['id']) {
    if (state.busy) return
    setStatus('处理中', '请稍候...', true)
    try {
      if (id === 'create') {
        await options.runtime.createRoom({ nickname, mode, rulesetId })
        await loadRoom(true)
      } else if (id === 'join') {
        await options.runtime.joinPendingInvite(nickname)
        await loadRoom(true)
      } else if (id === 'nickname') {
        nickname = (await requestKeyboard(nickname, 12)).trim() || DEFAULT_NICKNAME
        setStatus('选择联机玩法', '可创建房间，或输入好友房间码')
      } else if (id === 'mode') {
        mode = mode === 'east' ? 'hanchan' : 'east'
        setStatus('选择联机玩法', '可创建房间，或输入好友房间码')
      } else if (id === 'rules') {
        rulesetId = rulesetId === 'lotus-classic' ? 'lotus-legacy' : 'lotus-classic'
        setStatus('选择联机玩法', '可创建房间，或输入好友房间码')
      } else if (id === 'join-code') {
        joinCode = (await requestKeyboard(joinCode, 6)).trim().toUpperCase()
        await options.runtime.joinRoom(joinCode, nickname)
        await loadRoom(true)
      } else if (id === 'refresh') {
        await loadRoom()
      } else if (id === 'ready') {
        const seat = options.runtime.sessionStore.loadSession()?.seat
        const ready = state.room?.seats.find((item) => item?.seat === seat)?.ready ?? false
        await options.runtime.setReady(!ready)
        await loadRoom()
      } else if (id === 'share' && state.room) {
        await options.runtime.shareRoom(state.room.roomId)
        await loadRoom()
      } else if (id === 'start') {
        await options.runtime.startCurrentRoom()
        await loadRoom()
      } else if (id === 'leave') {
        allowReconnect = false
        if (reconnectTimer) clearTimeout(reconnectTimer)
        socket?.close()
        socket = null
        await options.runtime.leaveCurrentRoom()
        state.room = null
        state.socketStatus = '未连接'
        setStatus('已离开房间', '可创建房间，或输入好友房间码')
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

  // REST 房间操作不会广播大厅座位变化；短轮询保证准备页与浏览器版一样自动更新。
  const lobbyPoll = setInterval(async () => {
    if (!state.room || table.active() || state.busy) return
    try {
      const next = await options.runtime.getCurrentRoom()
      if (next) {
        state.room = next
        render()
      }
    } catch {
      // 瞬时网络错误交给下一轮；WebSocket 对局状态不受影响。
    }
  }, 1500)
  ;(lobbyPoll as unknown as { unref?: () => void }).unref?.()

  const ready = (async () => {
    try {
      await options.runtime.ensureLogin()
      await loadRoom(true)
    } catch (error) {
      setStatus('启动失败', readableError(error))
    }
  })()

  return {
    ready,
    render,
    getState: () => ({ ...state }),
    runAction,
    isTableActive: table.active,
    destroy() {
      allowReconnect = false
      clearInterval(lobbyPoll)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    },
  }
}
