import { MINI_MATCH_OPTIONS, miniMatchRounds } from './match-options'
import { miniTableLayout } from './table-layout'
import { THEME_PRESENTATIONS } from '../../src/theme/themePresentation.ts'
import { resolveTableActionPresentation, resolveRoundResultPresentation } from '../../src/theme/themeEventPresentation.ts'

const PALETTE = THEME_PRESENTATIONS.jade.palette
const AVATARS = ['lotus', 'ah-lok', 'shisan', 'young-master']
const WIND = ['东', '南', '西', '北']
const TILE_NAMES = { east: '东', south: '南', west: '西', north: '北', red: '中', green: '发', white: '白' }
const RULES = [
  ['牌张与翻癞子', '使用万、筒、索和中发白共 120 张，不使用风牌。开局掷骰翻指示牌：数牌按 1→9→1，发财→白板，红中或白板→发财，确定本局癞子。'],
  ['吃碰与截胡', '下家可吃普通数牌顺子，其他家可碰、直杠。弃牌先判胡，再按杠、碰、吃处理。一炮只允许按座次最近且确认的玩家胡牌。'],
  ['红中与癞子杠', '红中和癞子直接打出时立即按单张杠亮出，从牌墙尾补摸，不会作为普通弃牌，也不能被他家吃碰杠。'],
  ['胡牌限制', '结算胡分达到 9 分才可胡。屁胡最多使用 1 张癞子；碰碰胡、清一色、门前清、七对、龙七对、双龙七对等大胡可使用更多癞子。'],
  ['特殊胡法', '门前清单算 6 分，与其他大胡叠加时按 ×2 计入牌型底分，且须自摸或抢杠胡。支持全求人、杠上开花和抢杠胡。将一色、风一色、见字胡不计大胡。'],
  ['自摸计分', '自摸屁胡从 3 分起算，胡家杠番先计入基础分；每名付款者再按自己持有的杠独立翻倍。自摸大胡在牌型分上 ×1.5，门前清、杠上开花不重复计算。'],
  ['点炮计分', '点炮时三家均付款。七对、清一色、碰碰胡的放炮者按基础应付分 ×1.2，其他点炮按 ×2，其余两家不翻倍。'],
  ['杠番与封顶', '硬胡 ×2；红中杠、直杠、补杠 ×2，暗杠和癞子杠 ×4。每名付款者最多支付 50 分。每人起始 1000 分。'],
  ['场制与荒庄', '可选 4 局、8 局或 16 局，每次胡牌或荒庄都计为一局，连庄也计入局数。牌墙剩余 8 张时停止摸牌并荒庄。点击手牌选中，再次点击或向上滑动出牌。'],
]

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function tilePath(tile) {
  const suited = /^([mps])([1-9])$/.exec(tile || '')
  return `assets/tiles/${suited ? `${suited[2]}${suited[1]}` : `${['east', 'south', 'west', 'north', 'red', 'green', 'white'].indexOf(tile) + 1}z`}.png`
}
function tileName(tile) { return TILE_NAMES[tile] || `${tile?.[1] || ''}${({ m: '万', p: '筒', s: '索' })[tile?.[0]] || ''}` }
function rounded(ctx, x, y, w, h, r = 10) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

/** Native Canvas2D layer: the browser palette, lobby artwork, tile PNGs and avatars.
 * All coordinates and hit boxes are logical screen pixels, independent of DPR.
 * The host composites `canvas` and calls update with an unwrapped GamePort snapshot.
 */
export class MiniHud {
  constructor({ createCanvas, createImage, onAction, onInvalidate = () => {} }) {
    this.canvas = createCanvas(); this.ctx = this.canvas.getContext('2d')
    this.createImage = createImage; this.onAction = onAction; this.onInvalidate = onInvalidate
    this.images = new Map(); this.hits = []; this.handHits = []; this.state = { phase: 'lobby' }
    this.width = 844; this.height = 390; this.dpr = 1; this.safe = { left: 0, right: 0, top: 0, bottom: 0 }
    this.modal = null; this.rulePage = 0; this.hiddenResult = null; this.disposed = false
  }

  resize(system = {}) {
    this.width = system.windowWidth || system.screenWidth || this.width
    this.height = system.windowHeight || system.screenHeight || this.height
    this.dpr = clamp(system.pixelRatio || 1, 1, 2)
    this.menuButton = system.menuButton || null
    const safe = system.safeArea
    // Some WeChat hosts retain portrait safeArea coordinates after rotating the
    // screen canvas. Never subtract that portrait right edge from landscape width.
    const stalePortrait = this.width > this.height && safe
      && safe.bottom > this.height && safe.right <= this.height + 1
    if (stalePortrait) {
      const portraitHeight = Math.max(system.screenHeight || 0, system.screenWidth || 0, this.width)
      const edge = Math.max(0, safe.top || 0, portraitHeight - safe.bottom)
      this.safe = { left: Math.min(edge, this.width * .12), right: Math.min(edge, this.width * .12), top: 0, bottom: 0 }
    } else {
      const inset = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit ? value : 0
      this.safe = { left: inset(safe?.left, this.width * .12), top: inset(safe?.top, this.height * .2),
        right: inset(this.width - (safe?.right ?? this.width), this.width * .12),
        bottom: inset(this.height - (safe?.bottom ?? this.height), this.height * .2) }
    }
    const menu = this.menuButton
    if (menu && (menu.left < this.width / 2 || menu.right > this.width || menu.bottom > this.height / 3)) this.menuButton = null
    this.layout = miniTableLayout(this.width, this.height, this.safe, this.menuButton)
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr)
    this.render()
  }

  update(state) {
    const previousPhase = this.state.phase
    this.state = state
    if (previousPhase !== state.phase && state.phase === 'lobby') { this.modal = null; this.hiddenResult = null }
    this.render()
  }

  image(path, x, y, width, height, fit = 'cover') {
    let entry = this.images.get(path)
    if (!entry) {
      const image = this.createImage(); entry = { image, ready: false }; this.images.set(path, entry)
      image.onload = () => { if (!this.disposed) { entry.ready = true; this.render() } }
      image.onerror = () => { entry.failed = true }
      image.src = path
    }
    if (!entry.ready) return false
    const image = entry.image, iw = image.width || width, ih = image.height || height
    const scale = fit === 'contain' ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih)
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x, y, width, height); this.ctx.clip()
    this.ctx.drawImage(image, x + (width - iw * scale) / 2, y + (height - ih * scale) / 2, iw * scale, ih * scale)
    this.ctx.restore(); return true
  }

  box(x, y, w, h, fill = PALETTE.panel, border = null, radius = 10) {
    rounded(this.ctx, x, y, w, h, radius)
    if (fill) { this.ctx.fillStyle = fill; this.ctx.fill() }
    if (border) { this.ctx.strokeStyle = border; this.ctx.lineWidth = 1; this.ctx.stroke() }
  }

  text(text, x, y, size = 14, color = PALETTE.text, align = 'left', weight = 'normal', maxWidth) {
    this.ctx.fillStyle = color; this.ctx.textAlign = align; this.ctx.textBaseline = 'middle'
    this.ctx.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    if (maxWidth) this.ctx.fillText(String(text ?? ''), x, y, maxWidth)
    else this.ctx.fillText(String(text ?? ''), x, y)
  }

  wrapped(text, x, y, width, size = 12, lineHeight = 19, color = PALETTE.textMuted, maxLines = Infinity) {
    this.ctx.font = `normal ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    let line = '', row = 0
    for (const character of String(text)) {
      if (this.ctx.measureText(line + character).width > width && line && !'，。；：、！？）》」』】'.includes(character)) {
        this.text(line, x, y + row * lineHeight, size, color); row++; line = ''
        if (row >= maxLines) return row * lineHeight
      }
      line += character
    }
    if (line) { this.text(line, x, y + row * lineHeight, size, color); row++ }
    return row * lineHeight
  }

  button(x, y, w, h, label, action, options = {}) {
    const { primary = false, small = false, active = false, disabled = false, subtitle } = options
    this.ctx.save(); this.ctx.globalAlpha = disabled ? .45 : 1
    const fill = primary ? PALETTE.accent : active ? PALETTE.surface : PALETTE.panelElevated
    this.box(x, y + (primary ? 3 : 0), w, h, primary ? '#765820' : 'rgba(0,0,0,.2)', null, primary ? 11 : 8)
    this.box(x, y, w, h, fill, primary || active ? PALETTE.border : 'rgba(185,146,73,.35)', primary ? 11 : 8)
    this.text(label, x + w / 2, y + h / 2 - (subtitle ? 8 : 0), small ? 12 : 16,
      primary ? '#1a2418' : active ? PALETTE.accent : PALETTE.text, 'center', 'bold', w - 12)
    if (subtitle) this.text(subtitle, x + w / 2, y + h / 2 + 13, 10, primary ? '#435338' : PALETTE.textMuted, 'center', 'normal', w - 14)
    this.ctx.restore()
    if (!disabled) this.hits.push({ x, y, w, h, action })
  }

  render() {
    if (this.disposed) return
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height)
    this.hits = []; this.handHits = []
    if (this.width < this.height) { this.drawOrientation(); this.onInvalidate(); return }
    if (this.state.screen === 'lobby' || this.state.phase === 'lobby') this.drawLobby()
    else this.drawTable()
    if (this.modal) this.drawModal()
    else if (this.hasResult() && this.hiddenResult !== this.resultKey()) this.drawSettlement()
    this.onInvalidate()
  }

  drawOrientation() {
    this.ctx.fillStyle = PALETTE.panel; this.ctx.fillRect(0, 0, this.width, this.height)
    this.text('请横屏游玩', this.width / 2, this.height / 2 - 20, 26, PALETTE.accent, 'center', 'bold')
    this.text('横过手机，展开完整四人牌桌', this.width / 2, this.height / 2 + 20, 14, PALETTE.textMuted, 'center')
  }

  drawMatchOptions(x, y, width, height, selected, local = false) {
    const gap = 10, bw = (width - gap * 2) / 3
    MINI_MATCH_OPTIONS.forEach(({ value, rounds }, i) => this.button(x + i * (bw + gap), y, bw, height, `${rounds} 局`,
      local ? { local: 'room-match', value } : { type: 'match', value }, { active: selected === value }))
  }

  drawLobby() {
    if (this.state.online?.roomId) return this.drawOnlineRoom()
    const s = this.state, w = this.width, h = this.height
    const left = Math.max(22, this.safe.left + 12), right = Math.max(22, this.safe.right + 12)
    const ctx = this.ctx, top = Math.max(10, this.safe.top + 5)
    const bg = ctx.createRadialGradient(w * .3, h * .4, 10, w * .4, h * .45, w * .7)
    bg.addColorStop(0, '#193f2e'); bg.addColorStop(1, '#07110d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)
    this.text('武汉晃晃', left, top + 17, 16, PALETTE.accent, 'left', 'bold')
    this.button(left + 96, top, 58, 32, '规则', { local: 'rules' }, { small: true })
    this.button(left + 163, top, 76, 32, s.soundEnabled === false ? '声音：关' : '声音：开', { type: 'sound' }, { small: true })
    const contentTop = Math.max(top + 55, (this.menuButton?.bottom || 0) + 15)
    const bodyH = h - contentTop - Math.max(24, this.safe.bottom + 12)
    const leftW = (w - left - right) * .32, panelX = left + leftW + 24, panelW = w - panelX - right
    this.text('WUHAN HUANGHUANG', left, contentTop + 8, 10, PALETTE.accentSecondary, 'left', 'bold')
    this.text('武汉晃晃', left, contentTop + 44, clamp(h * .08, 26, 38), PALETTE.text, 'left', 'bold')
    this.text('四人同桌 · 翻癞子', left, contentTop + 73, 12, PALETTE.textMuted)
    const previewY = contentTop + 99, previewH = Math.max(40, Math.min(leftW * 9 / 16, bodyH - 135))
    ctx.save(); rounded(ctx, left, previewY, leftW, previewH, 12); ctx.clip()
    this.image('assets/themes/lobby/v1/jade.png', left, previewY, leftW, previewH)
    ctx.restore(); this.box(left, previewY, leftW, previewH, null, 'rgba(185,146,73,.4)', 12)
    this.text('默认墨玉 · 四人牌桌', left, previewY + previewH + 21, 11, PALETTE.textMuted)
    this.box(panelX, contentTop, panelW, bodyH, 'rgba(8,29,20,.9)', 'rgba(185,146,73,.3)', 15)
    const pad = 18, x = panelX + pad, innerW = panelW - pad * 2, y = contentTop
    const page = s.lobbyPage || 'modes'
    if (page === 'modes') {
      this.text('选择游戏模式', x, y + 28, 19, PALETTE.accent, 'left', 'bold')
      const gap = 12, cardW = (innerW - gap) / 2, cardY = y + 62, cardH = Math.max(78, bodyH - 110)
      this.button(x, cardY, cardW, cardH, '单机模式', { type: 'lobby-page', value: 'local' }, { subtitle: '与 AI 对战 · 直接开始', disabled: s.onlineBusy })
      this.button(x + cardW + gap, cardY, cardW, cardH, s.onlineBusy ? '正在登录…' : '联机模式',
        s.identity ? { type: 'lobby-page', value: 'online' } : { type: 'login' },
        { primary: true, subtitle: s.identity ? '创建房间 · 邀请好友' : '微信登录 · 与好友同桌', disabled: s.onlineBusy })
      this.text(s.invitedRoomId ? `好友邀请：房间 ${s.invitedRoomId} · 点击联机模式加入` : s.loginStatus || '选择适合你的节奏，随时开一桌', x, y + bodyH - 22, 10, PALETTE.textMuted, 'left', 'normal', innerW)
      return
    }
    this.button(x, y + 12, 60, 30, '返回', { type: 'lobby-page', value: 'modes' }, { small: true })
    this.text(page === 'local' ? '单机模式' : '联机模式', x + 74, y + 27, 18, PALETTE.accent, 'left', 'bold')
    if (page === 'local') {
      this.text('选择对局局数', x, y + 71, 14, PALETTE.text, 'left', 'bold')
      this.drawMatchOptions(x, y + 94, innerW, Math.min(64, bodyH - 175), s.selectedMatch)
      this.text('与三位 AI 同桌 · 连庄计入局数', x, y + bodyH - 80, 11, PALETTE.textMuted)
      this.button(x, y + bodyH - 60, innerW, 42, s.loading ? '正在准备牌桌…' : `开始 ${miniMatchRounds(s.selectedMatch)} 局对战`, { type: 'start' }, { primary: true, disabled: s.loading })
      if (s.loadError) this.text(s.loadError, x, y + bodyH - 9, 9, PALETTE.negative, 'left', 'normal', innerW)
      return
    }
    this.text(`${s.identity?.nickname || ''} · ID ${s.identity?.displayId || ''}`, x, y + 60, 11, PALETTE.textMuted, 'left', 'normal', innerW)
    const buttonW = (innerW - 10) / 2, actionY = y + 80
    this.button(x, actionY, buttonW, 36, s.canResume ? '重进房间' : '创建房间', s.canResume ? { type: 'resume-room' } : { local: 'create-room' }, { primary: true, small: true, disabled: s.onlineBusy })
    this.button(x + buttonW + 10, actionY, buttonW, 36, s.canResume ? '退出当前房间' : '加入房间', s.canResume ? { local: 'leave-saved-online' } : { type: 'join-room' }, { small: true, disabled: s.onlineBusy })
    this.text('可加入的房间', x, y + 143, 12, PALETTE.accent, 'left', 'bold')
    this.button(x + innerW - 54, y + 129, 54, 26, s.roomListLoading ? '刷新中' : '刷新', { type: 'refresh-rooms' }, { small: true, disabled: s.roomListLoading || s.onlineBusy })
    const rooms = s.roomList || [], listY = y + 168
    const rowH = Math.min(42, (bodyH - 186) / 2)
    if (rooms.length) rooms.slice(0, 4).forEach((room, i) => {
      this.button(x + (i % 2) * (buttonW + 10), listY + Math.floor(i / 2) * (rowH + 8), buttonW, rowH,
        `${room.roomId} · ${miniMatchRounds(room.mode)} 局 · ${room.occupied}/${room.capacity}人`,
        { type: 'join-listed-room', roomId: room.roomId }, { small: true, disabled: s.onlineBusy })
    })
    else this.wrapped(s.roomListError || (s.roomListLoading ? '正在获取房间…' : '暂无房间，创建一桌邀请好友吧'), x, listY + 14, innerW, 12, 19, PALETTE.textMuted, 2)
  }

  drawOnlineRoom() {
    const room = this.state.online, w = this.width, h = this.height
    this.box(0, 0, w, h, '#071a11', null, 0)
    const left = Math.max(12, this.safe.left + 6), top = Math.max(8, this.safe.top + 3)
    this.button(left, top, 76, 32, '退出联机', { local: 'leave-online' }, { small: true, disabled: this.state.onlineBusy })
    this.text(`武汉晃晃 · 房间 ${room.roomId}`, w / 2, 42, 22, PALETTE.accent, 'center', 'bold')
    this.text(`${miniMatchRounds(this.state.matchType)} 局 · 连接：${room.status === 'connected' ? '已连接' : '连接恢复中'} · 将房间号告诉好友即可加入`, w / 2, 78, 12, PALETTE.textMuted, 'center')
    const width = Math.min(160, (w - 80) / 4)
    for (let i = 0; i < 4; i++) {
      const seat = room.seats[i], x = w / 2 - width * 2 + i * width
      this.box(x + 5, h * .31, width - 10, 90, PALETTE.panelElevated, PALETTE.border)
      if (seat) this.image(seat.avatar || (i === room.mySeat ? this.state.identity?.avatarUrl : '') || 'assets/avatars/lotus.png', x + 12, h * .31 + 10, 30, 30)
      this.text(seat?.nickname || '等待加入', x + width / 2 + (seat ? 15 : 0), h * .31 + 27, 14, PALETTE.text, 'center')
      this.text(seat ? (seat.ready ? '已准备' : '未准备') : '空座由 AI 补位', x + width / 2, h * .31 + 60, 11, PALETTE.textMuted, 'center')
    }
    const y = h - 90, busy = this.state.onlineBusy || room.status !== 'connected'
    const actions = [
      ['退出房间', { local: 'leave-online' }, { disabled: this.state.onlineBusy }],
      ['分享邀请', { type: 'share-room' }, { disabled: this.state.onlineBusy }],
      [room.seats[room.mySeat]?.ready ? '取消准备' : '准备', { type: 'ready-room' }, { disabled: busy }],
      ...(room.isCreator ? [['开始对局', { type: 'start-room' }, { primary: true, disabled: busy }]] : []),
    ]
    const buttonW = 112, buttonGap = 16, totalW = actions.length * buttonW + (actions.length - 1) * buttonGap
    actions.forEach(([label, action, options], index) => this.button(w / 2 - totalW / 2 + index * (buttonW + buttonGap), y, buttonW, 40, label, action, options))
    if (room.error) this.text(room.error, w / 2, h - 26, 12, PALETTE.negative, 'center')
  }

  drawTable() {
    const s = this.state, w = this.width, h = this.height
    const { left, right, top, toolbar, seats } = this.layout
    const online = !!s.online?.roomId
    const topGradient = this.ctx.createLinearGradient(0, 0, 0, top + 38)
    topGradient.addColorStop(0, 'rgba(3,14,9,.8)'); topGradient.addColorStop(1, 'rgba(3,14,9,0)')
    this.ctx.fillStyle = topGradient; this.ctx.fillRect(0, 0, w, top + 38)
    this.button(left, top + 3, 76, 30, online ? '退出联机' : '返回大厅', { local: online ? 'leave-online' : 'leave' }, { small: true })
    this.text(`${miniMatchRounds(s.matchType)} 局 · 第 ${Math.min(s.round || 1, miniMatchRounds(s.matchType))} 局`, left + 88, top + 18, 12, PALETTE.text, 'left', 'bold')
    const controlW = (toolbar.w - 6) / 2
    this.button(toolbar.x, toolbar.y, controlW, 28, '规则', { local: 'rules' }, { small: true })
    this.button(toolbar.x + controlW + 6, toolbar.y, controlW, 28, s.soundEnabled === false ? '静音' : '声音', { type: 'sound' }, { small: true })
    const players = s.players || [], own = s.user || players[0], ownSeat = own?.seat ?? 0
    players.forEach((player, index) => {
      const rel = (index - ownSeat + 4) % 4
      const card = seats[rel]
      this.drawSeat(player, index, card.x, card.y, card.w, card.h, rel === 0)
    })
    const capabilities = s.capabilities?.lotusTable || {}, joker = s.jokerTiles || capabilities.jokerTiles || [], flip = s.flipTile || capabilities.flipTile
    const indicator = this.layout.indicator, compactIndicator = indicator.h < 50
    const tileW = compactIndicator ? 16 : 22, tileH = compactIndicator ? 21 : 29
    const tileY = indicator.y + (compactIndicator ? 15 : 23), labelY = indicator.y + (compactIndicator ? 8 : 12)
    this.box(indicator.x, indicator.y, indicator.w, indicator.h, 'rgba(5,24,15,.85)', 'rgba(185,146,73,.38)', 8)
    this.text('翻牌', indicator.x + 7, labelY, 9, PALETTE.textMuted)
    this.text('癞子', indicator.x + indicator.w / 2 + 5, labelY, 9, PALETTE.accent)
    if (flip) this.drawTile(flip, indicator.x + 10, tileY, tileW, tileH)
    else this.text('—', indicator.x + 18, tileY + tileH / 2, 13, PALETTE.textMuted)
    joker.forEach((tile, index) => this.drawTile(tile, indicator.x + indicator.w / 2 + 5 + index * (tileW + 1), tileY, tileW, tileH, { joker: true }))
    this.drawHand(own)
    this.drawActions()
    this.drawActionCue()
    const handY = this.handY || h - 80
    this.button(w - right - 71, h - this.safe.bottom - 46, 71, 31, s.autoPlay ? '取消托管' : '托管', { type: 'auto' }, { small: true, active: s.autoPlay })
    this.button(w - right - 71, h - this.safe.bottom - 83, 71, 31, '听牌提示', { local: 'hint' }, { small: true })
    let status = s.autoPlay ? '托管中，自动完成出牌与响应' : s.actionPrompt ? '请选择吃、碰、杠、胡或过' : s.isUserTurn ? (s.selectedIndex >= 0 ? '再次点击或上滑出牌 · 红中 / 癞子直接出牌开杠' : '轮到你出牌 · 点击选中，再点或上滑打出') : '等待其他玩家出牌'
    if (s.phase === 'opening' || s.phase === 'dealing') status = ({ dice: '庄家掷骰', flip: '翻牌确定癞子', deal: '正在发牌', start: '准备开局' })[s.openingStage] || '正在发牌'
    if (s.online && s.online.status !== 'connected') status = '连接中断，正在自动重连…'
    const statusY = own?.hand?.length ? handY - (s.selectedIndex >= 0 ? 28 : 12) : h - this.safe.bottom - 10
    this.text(status, this.layout.hand.x + this.layout.hand.w / 2, statusY, 10, PALETTE.textMuted, 'center', 'normal', this.layout.hand.w)
    if (s.announcement?.text && !this.hasResult()) this.wrapped(s.announcement.text, left, top + 53, 96, 11, 18, PALETTE.accent, 3)
    if (this.hasResult() && this.hiddenResult === this.resultKey()) this.button(w / 2 - 60, handY - 61, 120, 33, '查看结算', { local: 'result' }, { primary: true, small: true })
  }

  drawSeat(player, index, x, y, w, h, self) {
    const active = this.state.currentPlayer === index, stacked = w < 80
    const avatar = stacked ? 24 : Math.min(h - 12, 32)
    const avatarX = stacked ? x + (w - avatar) / 2 : x + 6, avatarY = y + (stacked ? 4 : 6)
    this.box(x, y, w, h, active ? 'rgba(26,66,45,.96)' : 'rgba(6,27,17,.9)', active ? PALETTE.accent : 'rgba(185,146,73,.4)', 9)
    this.ctx.save(); rounded(this.ctx, avatarX, avatarY, avatar, avatar, 6); this.ctx.clip()
    this.box(avatarX, avatarY, avatar, avatar, PALETTE.surface)
    this.image(player.avatar || `assets/avatars/${AVATARS[index % 4]}.png`, avatarX, avatarY, avatar, avatar)
    this.ctx.restore()
    const textX = stacked ? x + w / 2 : x + avatar + 12, align = stacked ? 'center' : 'left'
    const name = player.name || (self ? '你' : WIND[(index - (this.state.dealer || 0) + 4) % 4])
    const fontSize = stacked ? 10 : 11
    this.ctx.font = `bold ${fontSize}px \"PingFang SC\", sans-serif`
    const nameWidth = stacked ? w - 8 : w - avatar - 16
    let label = name
    while (label.length > 1 && this.ctx.measureText(label).width > nameWidth) label = label.slice(0, -2) + '…'
    this.text(label, textX, y + (stacked ? 35 : h / 2 - 7), fontSize, PALETTE.text, align, 'bold', nameWidth)
    this.text(player.score ?? 1000, textX, y + (stacked ? 48 : h / 2 + 9), stacked ? 10 : 12, PALETTE.accent, align, 'bold', nameWidth)
    if (index === this.state.dealer) { this.box(x + 2, y + 2, 16, 14, PALETTE.accent, null, 4); this.text('庄', x + 10, y + 9, 9, '#24301d', 'center', 'bold') }
    if (active && this.state.turnSeconds > 0) this.text(this.state.turnSeconds, x + w - 8, y + h - 10, 10, PALETTE.accent, 'right', 'bold')
    const delta = this.state.scoreFlowEvent?.deltas?.find(item => item.playerIndex === index)?.amount
    if (delta) this.text(`${delta > 0 ? '+' : ''}${delta}`, x + w / 2, y - 18, 20, delta > 0 ? PALETTE.positive : PALETTE.negative, 'center', 'bold')
  }

  drawTile(tile, x, y, w, h, { selected = false, joker = false, special = false, muted = false } = {}) {
    const ctx = this.ctx
    ctx.save(); if (muted) ctx.globalAlpha = .72
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = selected ? 9 : 4; ctx.shadowOffsetY = 3
    this.box(x, y + 5, w, h, '#307038', null, 4)
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    this.box(x, y + 2, w, h, '#c8cec1', null, 4)
    const gradient = ctx.createLinearGradient(x, y, x, y + h)
    gradient.addColorStop(0, '#fffff6'); gradient.addColorStop(.75, '#e7e5d8'); gradient.addColorStop(1, '#cdcebe')
    this.box(x, y, w, h, gradient, selected ? '#f4ce70' : '#acb2a2', 4)
    const rendered = this.image(tilePath(tile), x + 2, y + 1, w - 4, h - 3, 'contain')
    if (!rendered) this.text(tileName(tile), x + w / 2, y + h / 2, Math.min(w * .65, 27), '#234b2c', 'center', 'bold')
    if (selected) { ctx.lineWidth = 2; rounded(ctx, x - 1, y - 1, w + 2, h + 2, 5); ctx.strokeStyle = '#f4ce70'; ctx.stroke() }
    if (joker || special) {
      this.box(x + w - 14, y - 3, 16, 15, joker ? '#b98e32' : '#a63e30', null, 3)
      this.text(joker ? '癞' : '杠', x + w - 6, y + 5, 9, '#fff8e4', 'center', 'bold')
    }
    ctx.restore()
  }

  drawHand(player) {
    if (!player) return
    const s = this.state, hand = player.hand || [], w = this.width, h = this.height
    const available = this.layout.hand.w
    const gap = 2, drawnGap = player.drawnTileIndex >= 0 ? 9 : 0
    const tileW = clamp((available - Math.max(0, hand.length - 1) * gap - drawnGap) / Math.max(14, hand.length), 18, 54)
    const tileH = tileW * 1.37, rowW = hand.length * (tileW + gap) - gap + drawnGap
    const startX = this.layout.hand.x + (available - rowW) / 2, y = h - Math.max(14, this.safe.bottom + 9) - tileH
    this.handY = y
    const jokerTiles = s.jokerTiles || s.capabilities?.lotusTable?.jokerTiles || []
    let offset = 0
    hand.forEach((tile, index) => {
      if (index === player.drawnTileIndex) offset += drawnGap
      const selected = index === s.selectedIndex, x = startX + index * (tileW + gap) + offset, ty = y - (selected ? 16 : 0)
      this.drawTile(tile, x, ty, tileW, tileH, { selected, joker: jokerTiles.includes(tile), special: tile === 'red', muted: !s.isUserTurn || s.autoPlay })
      const hit = { x: x - 1, y: ty - 4, w: tileW + 2, h: tileH + 12, index }
      this.handHits.push(hit)
      if (s.isUserTurn && !s.autoPlay && !this.hasResult()) this.hits.push({ ...hit, action: { type: selected ? 'discard' : 'select', index } })
    })
  }

  drawActions() {
    const s = this.state
    let actions = s.actions || []
    if (!actions.length || s.autoPlay) return
    actions = actions.filter(a => a.type !== 'discard' && a.id !== 'discard' && a.id !== 'select')
    const chiActions = actions.filter(action => action.type === 'chi')
    if (chiActions.length > 1) actions = actions.filter(action => action.type !== 'chi').concat({ id: 'chi', type: 'chi', label: '吃' })
    if (!actions.length) return
    const xEnd = Math.min(this.layout.hand.x + this.layout.hand.w, this.layout.toolbar.x - 8), gap = 8
    const bw = 64, bh = 42, perRow = Math.max(1, Math.floor((xEnd - this.layout.hand.x) / (bw + gap)))
    actions.forEach((action, index) => {
      const column = index % perRow, row = Math.floor(index / perRow)
      const rowCount = Math.min(perRow, actions.length - row * perRow)
      const x = xEnd - rowCount * (bw + gap) + column * (bw + gap)
      const y = this.handY - 82 - row * (bh + 7)
      const id = action.id || action.type, label = action.label || ({ hu: '胡', peng: '碰', gang: '杠', chi: '吃', pass: '过', windKong: '风杠' })[id] || id
      if (id === 'chi' && chiActions.length > 1) {
        this.button(x, y, bw, bh, label, { local: 'chi' }, { primary: true })
      } else {
        this.button(x, y, bw, bh, label, { type: 'action', id, tile: action.tile, optionIndex: action.optionIndex }, { primary: id !== 'pass', small: label.length > 3, subtitle: action.tile ? tileName(action.tile) : null })
      }
    })
  }

  drawActionCue() {
    const event = this.state.tableActionEvent
    if (!event || this.hasResult()) return
    const presentation = resolveTableActionPresentation(event.type)
    if (!presentation) return
    const ownSeat = this.state.user?.seat ?? 0
    const rel = (event.actorIndex - ownSeat + 4) % 4
    const seat = this.layout.seats[rel] || this.layout.seats[0]
    const y = rel === 0 ? seat.y - 18 : seat.y + seat.h + 15
    this.ctx.save(); this.ctx.shadowColor = '#071a11'; this.ctx.shadowBlur = 6
    this.text(presentation.label, seat.x + seat.w / 2, y, 20, PALETTE.accent, 'center', 'bold', seat.w)
    this.ctx.restore()
  }

  hasResult() { return !!this.state.result && ['settled', 'finished'].includes(this.state.phase) || !!this.state.matchFinished }
  resultKey() { return this.state.result?.presentationKey || `${this.state.roundLabel}/${this.state.result?.winnerIndex}/${this.state.matchFinished}` }

  modalShell(title, width = 570, height = 330) {
    this.hits = []; this.handHits = []
    this.ctx.fillStyle = 'rgba(0,8,4,.76)'; this.ctx.fillRect(0, 0, this.width, this.height)
    width = Math.min(width, this.width - this.safe.left - this.safe.right - 38)
    height = Math.min(height, this.height - this.safe.top - this.safe.bottom - 26)
    const x = (this.width - width) / 2, y = (this.height - height) / 2
    this.box(x, y, width, height, PALETTE.panel, PALETTE.border, 14)
    this.text(title, x + 22, y + 26, 20, PALETTE.accent, 'left', 'bold')
    this.button(x + width - 57, y + 10, 39, 31, '×', { local: 'close' }, { small: true })
    return { x, y, w: width, h: height }
  }

  drawModal() {
    if (this.modal === 'create-room') {
      const b = this.modalShell('创建联机房间', 460, 245)
      this.text('选择局数 · 连庄计入局数', b.x + 24, b.y + 70, 13, PALETTE.textMuted)
      this.drawMatchOptions(b.x + 24, b.y + 96, b.w - 48, 50, this.roomMatch, true)
      this.button(b.x + 24, b.y + b.h - 68, b.w - 48, 42, `创建 ${miniMatchRounds(this.roomMatch)} 局房间`, { type: 'create-room', matchType: this.roomMatch }, { primary: true, disabled: this.state.onlineBusy })
    } else if (this.modal === 'rules') {
      const b = this.modalShell('武汉晃晃玩法', 620, 420)
      const count = b.h < 340 ? 2 : 3, pages = Math.ceil(RULES.length / count)
      this.rulePage = clamp(this.rulePage, 0, pages - 1)
      const itemH = (b.h - 113) / count
      RULES.slice(this.rulePage * count, (this.rulePage + 1) * count).forEach(([title, body], index) => {
        const y = b.y + 64 + index * itemH
        this.text(String(this.rulePage * count + index + 1).padStart(2, '0'), b.x + 23, y, 18, PALETTE.accentSecondary, 'left', 'bold')
        this.text(title, b.x + 60, y, 14, PALETTE.text, 'left', 'bold')
        this.wrapped(body, b.x + 60, y + 23, b.w - 85, 12, 18, PALETTE.textMuted, Math.floor((itemH - 20) / 18))
      })
      this.button(b.x + 22, b.y + b.h - 46, 74, 29, '上一页', { local: 'rule-prev' }, { small: true, disabled: this.rulePage === 0 })
      this.button(b.x + b.w - 96, b.y + b.h - 46, 74, 29, '下一页', { local: 'rule-next' }, { small: true, disabled: this.rulePage === pages - 1 })
      this.text(`${this.rulePage + 1} / ${pages}  ·  仅供娱乐，禁止赌博`, b.x + b.w / 2, b.y + b.h - 31, 10, PALETTE.textMuted, 'center')
    } else if (this.modal === 'leave') {
      const b = this.modalShell('返回大厅', 420, 204)
      this.text('当前对局将结束，确定返回大厅？', b.x + b.w / 2, b.y + 88, 14, PALETTE.text, 'center')
      this.button(b.x + 24, b.y + b.h - 66, (b.w - 60) / 2, 42, '继续对局', { local: 'close' })
      this.button(b.x + b.w / 2 + 6, b.y + b.h - 66, (b.w - 60) / 2, 42, '返回大厅', { type: 'lobby' }, { primary: true })
    } else if (this.modal === 'leave-online' || this.modal === 'leave-saved-online') {
      const b = this.modalShell('退出联机', 440, 224)
      const playing = this.modal === 'leave-online' && this.state.phase !== 'lobby'
      this.text(playing ? '确定退出当前联机对局？' : '确定退出当前联机房间？', b.x + b.w / 2, b.y + 82, 15, PALETTE.text, 'center', 'bold')
      this.text(playing ? '退出后将释放座位，本局由 AI 接管。' : '退出后将释放座位，并返回游戏大厅。', b.x + b.w / 2, b.y + 115, 12, PALETTE.textMuted, 'center')
      this.button(b.x + 24, b.y + b.h - 66, (b.w - 60) / 2, 42, '继续游戏', { local: 'close' })
      this.button(b.x + b.w / 2 + 6, b.y + b.h - 66, (b.w - 60) / 2, 42, '确认退出', { type: 'leave-room' }, { primary: true })
    } else if (this.modal === 'hint') {
      const b = this.modalShell('听牌提示', 520, 280)
      const s = this.state, waits = s.userDiscardWaits || s.userCurrentWaits
      if (waits?.tiles?.length || waits?.any) {
        this.text(waits.discard ? `打出 ${tileName(waits.discard)} 后可听` : '当前已听牌', b.x + 24, b.y + 70, 15, PALETTE.text, 'left', 'bold')
        if (waits.any) this.text('任意牌均可胡', b.x + 24, b.y + 112, 20, PALETTE.accent)
        else (waits.tiles || []).slice(0, 18).forEach((wait, index) => {
          const x = b.x + 26 + (index % 9) * 50, y = b.y + 92 + Math.floor(index / 9) * 78
          this.drawTile(wait.tile, x, y, 31, 41)
          this.text(`余 ${wait.remaining}`, x + 15, y + 58, 10, PALETTE.textMuted, 'center')
        })
        this.text('胡牌还须满足 9 分起胡等规则，以亮起的胡按钮为准', b.x + 24, b.y + b.h - 24, 11, PALETTE.textMuted, 'left', 'normal', b.w - 48)
      } else if (s.userTingOptions?.length) {
        this.text('可打出以下手牌进入听牌', b.x + 24, b.y + 74, 14, PALETTE.text)
        s.userTingOptions.slice(0, 8).forEach((wait, index) => {
          const x = b.x + 26 + index * 54
          this.drawTile(wait.discard, x, b.y + 106, 33, 44)
          this.text(`${wait.remaining} 张`, x + 17, b.y + 171, 10, PALETTE.textMuted, 'center')
          this.hits.push({ x: x - 3, y: b.y + 102, w: 43, h: 77, action: { local: 'hint-select', tile: wait.discard } })
        })
        this.text('点击牌面选中对应手牌，再查看具体听牌', b.x + 24, b.y + b.h - 27, 11, PALETTE.textMuted)
      } else {
        this.text('当前还未听牌', b.x + b.w / 2, b.y + 122, 23, PALETTE.accent, 'center', 'bold')
        this.text('选择一张手牌后，可以查看打出后的听牌信息', b.x + b.w / 2, b.y + 162, 12, PALETTE.textMuted, 'center', 'normal', b.w - 44)
      }
    } else if (this.modal === 'chi') {
      const choices = this.state.actionPrompt?.chiOptions || [], b = this.modalShell('选择吃牌组合', 540, 260)
      choices.forEach((choice, index) => {
        const x = b.x + 22 + index * 158
        ;(choice.tiles || choice).forEach((tile, tileIndex) => this.drawTile(tile, x + tileIndex * 39, b.y + 77, 34, 46))
        this.button(x, b.y + 157, 113, 37, '吃这组', { type: 'action', id: 'chi', optionIndex: index }, { primary: true, small: true })
      })
    }
  }

  drawSettlement() {
    const s = this.state, result = s.result || {}, finished = !!s.matchFinished
    const title = finished ? '最终排名' : result.draw ? '荒庄' : result.kongBloom ? '杠上开花' : resolveRoundResultPresentation(result).label
    const b = this.modalShell(title, 620, 430)
    // Closing a result only returns to the revealed table; it never advances play.
    this.hits[this.hits.length - 1].action = { local: 'hide-result' }
    this.text(`${s.matchName || ''} · ${result.roundLabel || s.roundLabel || ''}`, b.x + b.w - 70, b.y + 27, 11, PALETTE.textMuted, 'right')
    let rowsY = b.y + 103
    if (!finished && !result.draw) {
      const gain = result.totalWon ?? result.scoreChanges?.find(entry => entry.playerIndex === result.winnerIndex)?.delta
      this.text(`${result.winner || s.players?.[result.winnerIndex]?.name || '胡牌'}${gain != null ? `  +${gain}` : ''}`, b.x + 23, b.y + 60, 19, PALETTE.text, 'left', 'bold')
      const details = (result.details || []).map(detail => `${detail.label} ${detail.points != null ? `${detail.points}分` : `×${detail.multiplier}`}`).join('  ·  ')
      this.text(details, b.x + 23, b.y + 84, 10, PALETTE.textMuted, 'left', 'normal', b.w - 46)
    } else { this.text(finished ? '本场对局结束' : '牌墙剩余 8 张 · 本局结束', b.x + 23, b.y + 65, 13, PALETTE.textMuted); rowsY = b.y + 90 }
    const entries = finished && s.standings?.length ? s.standings : result.scoreChanges || []
    const rowH = Math.min(53, (b.h - (rowsY - b.y) - 76) / Math.max(1, entries.length))
    entries.forEach((entry, index) => {
      const seat = entry.playerIndex ?? entry.seat ?? index, y = rowsY + index * rowH
      this.box(b.x + 20, y, b.w - 40, rowH - 5, seat === result.winnerIndex ? PALETTE.surface : PALETTE.panelElevated, seat === result.winnerIndex ? 'rgba(185,146,73,.6)' : null, 7)
      this.text(entry.rank || index + 1, b.x + 38, y + (rowH - 5) / 2, 17, PALETTE.accent, 'center', 'bold')
      const avatarSize = Math.min(34, rowH - 11)
      this.ctx.save(); rounded(this.ctx, b.x + 57, y + 4, avatarSize, avatarSize, 5); this.ctx.clip()
      this.image(`assets/avatars/${AVATARS[seat % 4]}.png`, b.x + 57, y + 4, avatarSize, avatarSize); this.ctx.restore()
      const payerDetails = !finished ? (result.payerKongDetails?.[seat] || []).map(detail => `${detail.label} ×${detail.multiplier}`) : []
      if (!finished && seat === result.discarderIndex && result.discarderMultiplier) payerDetails.unshift(`点炮 ×${result.discarderMultiplier}`)
      this.text(`${entry.name || s.players?.[seat]?.name || '玩家'}${seat === 0 ? '（你）' : ''}`, b.x + 102, y + (payerDetails.length ? 13 : (rowH - 5) / 2), 12, PALETTE.text, 'left', 'bold', b.w * .36)
      if (payerDetails.length) this.text(payerDetails.join(' · '), b.x + 102, y + rowH - 14, 9, PALETTE.textMuted, 'left', 'normal', b.w * .36)
      if (!finished) this.text(`${entry.delta > 0 ? '+' : ''}${entry.delta ?? 0}`, b.x + b.w - 120, y + (rowH - 5) / 2, 17, entry.delta > 0 ? PALETTE.positive : entry.delta < 0 ? PALETTE.negative : PALETTE.textMuted, 'right', 'bold')
      this.text(entry.score, b.x + b.w - 37, y + (rowH - 5) / 2, 16, PALETTE.accent, 'right', 'bold')
    })
    const footerY = b.y + b.h - 62
    if (finished) this.button(b.x + b.w / 2 - 100, footerY, 200, 38, '返回大厅', { type: 'lobby' }, { primary: true })
    else {
      this.button(b.x + 24, footerY, (b.w - 60) / 2, 38, '查看牌桌', { local: 'hide-result' }, { small: true })
      this.button(b.x + b.w / 2 + 6, footerY, (b.w - 60) / 2, 38, '继续', { type: 'next' }, { primary: true })
    }
    this.text('游戏结果禁止用于赌博行为', b.x + b.w / 2, b.y + b.h - 11, 9, PALETTE.textMuted, 'center')
  }

  hitTest(x, y) { return [...this.hits].reverse().find(hit => x >= hit.x && y >= hit.y && x <= hit.x + hit.w && y <= hit.y + hit.h)?.action || null }

  get hitRegions() { return this.hits }

  handleTouch(x, y) {
    const action = this.hitTest(x, y)
    if (!action) {
      if (!this.modal && !this.hasResult() && this.state.selectedIndex >= 0) this.onAction({ type: 'clear-selection' })
      return false
    }
    if (action.local) {
      switch (action.local) {
        case 'create-room': this.roomMatch = this.state.selectedMatch || 'rounds4'; this.modal = 'create-room'; break
        case 'room-match': this.roomMatch = action.value; break
        case 'close': this.modal = null; break
        case 'rules': this.rulePage = 0; this.modal = 'rules'; break
        case 'rule-prev': this.rulePage--; break
        case 'rule-next': this.rulePage++; break
        case 'leave': this.modal = 'leave'; break
        case 'leave-online': this.modal = 'leave-online'; break
        case 'leave-saved-online': this.modal = 'leave-saved-online'; break
        case 'hint': this.modal = 'hint'; break
        case 'chi': this.modal = 'chi'; break
        case 'hide-result': this.hiddenResult = this.resultKey(); break
        case 'result': this.hiddenResult = null; break
        case 'hint-select': {
          const hand = this.state.user?.hand || this.state.players?.[0]?.hand || []
          const index = hand.indexOf(action.tile)
          this.modal = null; if (index >= 0) this.onAction({ type: 'select', index }); break
        }
      }
      this.render()
    } else { this.modal = null; this.onAction(action); this.render() }
    return true
  }

  handleSwipe(startX, startY, endX, endY) {
    if (this.modal === 'rules' && Math.abs(endX - startX) > 40) {
      this.rulePage += endX < startX ? 1 : -1; this.render(); return true
    }
    if (this.modal || this.hasResult() || !this.state.isUserTurn || this.state.autoPlay || startY - endY < 24 || Math.abs(endX - startX) > Math.max(70, startY - endY)) return false
    const hit = this.handHits.find(item => startX >= item.x && startX <= item.x + item.w && startY >= item.y && startY <= item.y + item.h)
    if (!hit) return false
    this.onAction({ type: 'discard', index: hit.index }); return true
  }

  dispose() {
    this.disposed = true
    for (const entry of this.images.values()) { entry.image.onload = null; entry.image.onerror = null }
    this.images.clear(); this.hits = []; this.handHits = []
  }
}
