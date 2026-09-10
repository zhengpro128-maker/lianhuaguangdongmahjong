import type { WechatGameRuntime, WechatRoomInfo } from './runtime'
import { errorMessage, type WxGameApi, type WxTouchEvent } from './wx'

type LobbyAction = 'create' | 'join' | 'refresh' | 'ready' | 'share' | 'start'
type TableAction = 'pass' | 'hu' | 'peng' | 'gang' | 'chi' | 'continue'

interface Button {
  id: LobbyAction | TableAction
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
  table: TableSnapshot | null
  request: TableRequest | null
  tableNotice: string
}

interface TablePlayer {
  seat: number
  name?: string
  nickname?: string
  score?: number
  hand: Array<string | null>
  discards?: string[]
  melds?: Array<{ type?: string; tile?: string; tiles?: string[] }>
}

interface TableSnapshot {
  kind: 'state_snapshot'
  phase: string
  round: number
  dealer: number
  currentPlayer: number
  wallCount: number
  seat: number
  players: TablePlayer[]
  lastDiscard?: { tile?: string; from?: number } | null
  result?: { draw?: boolean; winnerIndex?: number; presentationKey?: string } | null
}

interface TableRequest {
  kind: 'turn_request' | 'claim_request' | 'rob_kong_request'
  ctx: {
    hand?: string[]
    canHu?: boolean
    canPeng?: boolean
    canGang?: boolean
    chiOptions?: unknown[]
    tile?: string
  }
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
    table: null,
    request: null,
    tableNotice: '',
  }
  let buttons: Button[] = []
  let socket: ReturnType<WechatGameRuntime['socketFactory']> | null = null

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

  function tileLabel(tile: string | null): string {
    if (!tile) return '🀫'
    const special: Record<string, string> = {
      east: '东', south: '南', west: '西', north: '北', red: '中', green: '发', white: '白',
    }
    if (special[tile]) return special[tile]
    const suit = tile[0]
    const number = tile.slice(1)
    return `${number}${suit === 'm' ? '万' : suit === 'p' ? '筒' : suit === 's' ? '条' : ''}`
  }

  function playerForSeat(snapshot: TableSnapshot, seat: number) {
    return snapshot.players.find((player) => player.seat === seat)
  }

  function localPosition(serverSeat: number, mySeat: number) {
    return (serverSeat - mySeat + 4) % 4
  }

  function drawTile(tile: string | null, x: number, y: number, w: number, h: number, hidden = false) {
    context.fillStyle = hidden ? '#2e5c44' : '#f6f0dd'
    context.fillRect(x, y, w, h)
    context.fillStyle = hidden ? '#91b39e' : '#1d2721'
    context.font = `${Math.max(10, Math.floor(h * .42))}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(hidden ? '▦' : tileLabel(tile), x + w / 2, y + h / 2)
  }

  function tableButtons(snapshot: TableSnapshot): Button[] {
    const request = state.request
    const actions: Array<{ id: TableAction; label: string }> = []
    if (request?.kind === 'turn_request' && request.ctx.canHu) actions.push({ id: 'hu', label: '胡' })
    if (request?.kind === 'claim_request') {
      if (request.ctx.canHu) actions.push({ id: 'hu', label: '胡' })
      if (request.ctx.canGang) actions.push({ id: 'gang', label: '杠' })
      if (request.ctx.canPeng) actions.push({ id: 'peng', label: '碰' })
      if (request.ctx.chiOptions?.length) actions.push({ id: 'chi', label: '吃' })
      actions.push({ id: 'pass', label: '过' })
    }
    if (request?.kind === 'rob_kong_request') actions.push({ id: 'hu', label: '抢杠胡' }, { id: 'pass', label: '过' })
    if (snapshot.phase === 'settled') actions.push({ id: 'continue', label: '下一局' })
    const gap = 8
    const buttonWidth = Math.min(84, (width - 32 - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length))
    const startX = width - 16 - (buttonWidth * actions.length + gap * Math.max(0, actions.length - 1))
    return actions.map((action, index) => ({
      ...action,
      x: startX + index * (buttonWidth + gap), y: height - 126, width: buttonWidth, height: 38,
    }))
  }

  function renderTable(snapshot: TableSnapshot) {
    context.fillStyle = '#071711'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#174b36'
    context.fillRect(14, 44, width - 28, Math.max(126, height - 194))
    context.fillStyle = '#caa24c'
    context.font = '700 15px sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.fillText(`东风场 · 第 ${snapshot.round} 局 · 余 ${snapshot.wallCount} 张`, 18, 28)
    context.fillStyle = '#b9c9c0'
    context.font = '12px sans-serif'
    context.fillText(`房间 ${state.room?.roomId ?? ''} · ${state.socketStatus}`, width - 174, 28)

    const positions: Array<[number, number]> = [
      [width / 2, height - 154], [width - 82, height / 2], [width / 2, 78], [82, height / 2],
    ]
    for (const player of snapshot.players) {
      const relative = localPosition(player.seat, snapshot.seat)
      const [x, y] = positions[relative]
      const active = player.seat === snapshot.currentPlayer
      context.fillStyle = active ? '#d7b85e' : '#10271e'
      context.fillRect(x - 58, y - 20, 116, 38)
      context.fillStyle = active ? '#102019' : '#e8efe9'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = '700 13px sans-serif'
      context.fillText(player.nickname ?? player.name ?? `玩家 ${player.seat + 1}`, x, y - 6)
      context.font = '12px sans-serif'
      context.fillText(`${player.score ?? 0} 分`, x, y + 10)
    }

    const last = snapshot.lastDiscard?.tile ? `最近弃牌：${tileLabel(snapshot.lastDiscard.tile)}` : '等待出牌'
    context.fillStyle = '#dbe7dc'
    context.font = '700 17px sans-serif'
    context.textAlign = 'center'
    context.fillText(last, width / 2, height / 2 - 2)
    if (state.tableNotice) {
      context.fillStyle = '#f5d66a'
      context.font = '13px sans-serif'
      context.fillText(state.tableNotice, width / 2, height / 2 + 24)
    }

    const me = playerForSeat(snapshot, snapshot.seat)
    const hand = me?.hand ?? []
    const tileGap = 2
    const tileWidth = Math.max(19, Math.min(42, (width - 24 - tileGap * Math.max(0, hand.length - 1)) / Math.max(1, hand.length)))
    const handWidth = hand.length * tileWidth + Math.max(0, hand.length - 1) * tileGap
    const handX = (width - handWidth) / 2
    const handY = height - 74
    hand.forEach((tile, index) => drawTile(tile, handX + index * (tileWidth + tileGap), handY, tileWidth, 56))

    buttons = tableButtons(snapshot)
    buttons.forEach(drawButton)
    if (snapshot.phase === 'settled') {
      context.fillStyle = '#f1e7cd'
      context.font = '700 20px sans-serif'
      context.textAlign = 'center'
      context.fillText(snapshot.result?.draw ? '本局流局' : '本局结算', width / 2, height / 2 - 32)
    }
  }

  function render() {
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (state.table) {
      renderTable(state.table)
      return
    }
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
        const message = JSON.parse(event.data) as { kind?: string }
        if (message.kind === 'state_snapshot') {
          const snapshot = message as TableSnapshot
          state.table = snapshot
          state.request = null
          state.tableNotice = snapshot.phase === 'opening' ? '正在发牌…' : ''
          if (snapshot.phase === 'opening') {
            socket?.send(JSON.stringify({ type: 'opening_done', round: snapshot.round }))
          }
        } else if (message.kind === 'turn_request' || message.kind === 'claim_request' || message.kind === 'rob_kong_request') {
          state.request = message as TableRequest
          state.tableNotice = message.kind === 'turn_request' ? '轮到你出牌' : '请选择操作'
        } else if (message.kind === 'continue_prompt') {
          state.tableNotice = '本局结束，点击下一局'
        } else if (message.kind === 'announcement') {
          state.tableNotice = String((message as { text?: unknown }).text ?? '')
        } else if (message.kind === 'error') {
          state.tableNotice = `操作失败：${String((message as { code?: unknown }).code ?? '未知错误')}`
        }
        render()
      } catch {
        state.tableNotice = '收到无法识别的对局消息'
        render()
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

  function sendTableAction(id: TableAction) {
    if (!socket) return
    const payload = id === 'pass' ? { type: 'pass' }
      : id === 'hu' ? { type: 'hu' }
        : id === 'peng' ? { type: 'claim', action: 'peng' }
          : id === 'gang' ? { type: 'claim', action: 'gang' }
            : id === 'chi' ? { type: 'claim', action: 'chi', optionIndex: 0 }
              : { type: 'continue', presentationKey: state.table?.result?.presentationKey }
    socket.send(JSON.stringify(payload))
    state.request = null
    state.tableNotice = '操作已发送，等待服务端确认…'
    render()
  }

  async function runAction(id: LobbyAction | TableAction) {
    if (id === 'pass' || id === 'hu' || id === 'peng' || id === 'gang' || id === 'chi' || id === 'continue') {
      sendTableAction(id)
      return
    }
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
    const touch = event.changedTouches?.[0]
    const x = touch?.clientX ?? touch?.pageX
    const y = touch?.clientY ?? touch?.pageY
    if (x === undefined || y === undefined) return
    const button = buttons.find((item) => (
      x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height
    ))
    if (button) {
      void runAction(button.id)
      return
    }
    const table = state.table
    if (!table || state.request?.kind !== 'turn_request') return
    const me = playerForSeat(table, table.seat)
    const hand = me?.hand ?? []
    if (y < height - 82 || !hand.length) return
    const tileGap = 2
    const tileWidth = Math.max(19, Math.min(42, (width - 24 - tileGap * Math.max(0, hand.length - 1)) / hand.length))
    const handWidth = hand.length * tileWidth + Math.max(0, hand.length - 1) * tileGap
    const index = Math.floor((x - (width - handWidth) / 2) / (tileWidth + tileGap))
    if (index >= 0 && index < hand.length && socket) {
      socket.send(JSON.stringify({ type: 'discard', handIndex: index }))
      state.request = null
      state.tableNotice = '出牌已发送，等待服务端确认…'
      render()
    }
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
