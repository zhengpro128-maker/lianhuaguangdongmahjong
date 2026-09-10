import { tileFaceFile } from '../game/core/rules/tiles'
import type { ServerSnapshot } from '../game/online/protocol/dto'
import type { ServerMessage } from '../game/online/protocol/messages'
import type { TileType } from '../game/core/contracts/types'
import type { SocketLike } from '../game/online/transport/roomSocket'
import type { WxGameApi, WxImageLike, WxTouchEvent } from './wx'

/**
 * 小游戏原生牌桌。
 *
 * 这不是另一套皮肤：颜色、牌背、牌面和四席桌面结构均取自浏览器版的
 * MahjongTable3D / GameTableHud。小游戏没有 DOM/Vue 层，因而把同一套资产
 * 和布局映射至原生 Canvas；联机状态仍只消费服务端 state_snapshot。
 */
interface HitRegion { x: number; y: number; width: number; height: number; action: () => void }

const JADE = '#254223'
const DARK_JADE = '#08271c'
const GOLD = '#caa24c'
const GOLD_HIGHLIGHT = '#e1b85d'
const PANEL = 'rgba(7, 31, 23, .92)'
const PLAYER_WIND = ['东', '南', '西', '北']

function playerAt(snapshot: ServerSnapshot, localIndex: number) {
  const absoluteSeat = (snapshot.seat + localIndex) % 4
  return snapshot.players.find((player) => player.seat === absoluteSeat) ?? null
}

function point(event: WxTouchEvent) {
  const touch = event.changedTouches?.[0]
  if (!touch) return null
  const x = touch.clientX ?? touch.pageX
  const y = touch.clientY ?? touch.pageY
  return x === undefined || y === undefined ? null : { x, y }
}

export function createWechatNativeTable(options: {
  wx: WxGameApi
  context: CanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  send: (message: Record<string, unknown>) => void
}) {
  const { wx, context } = options
  const images = new Map<string, WxImageLike>()
  let snapshot: ServerSnapshot | null = null
  let prompt: Extract<ServerMessage, { kind: 'turn_request' | 'claim_request' | 'rob_kong_request' }> | null = null
  let hitRegions: HitRegion[] = []
  let detail = ''

  function image(path: string) {
    const cached = images.get(path)
    if (cached) return cached
    const next = wx.createImage()
    next.onload = () => render()
    next.onerror = () => { /* 资源缺失时保留牌面几何，不能阻断对局。 */ }
    next.src = path
    images.set(path, next)
    return next
  }

  function tileImage(tile: TileType | null) {
    if (!tile) return image('tiles/tile-back.png')
    const file = tileFaceFile(tile)
    return image(file ? `tiles/${file}` : 'tiles/tile-back.png')
  }

  function rounded(x: number, y: number, width: number, height: number, radius: number) {
    context.beginPath()
    context.moveTo(x + radius, y)
    context.lineTo(x + width - radius, y)
    context.quadraticCurveTo(x + width, y, x + width, y + radius)
    context.lineTo(x + width, y + height - radius)
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    context.lineTo(x + radius, y + height)
    context.quadraticCurveTo(x, y + height, x, y + height - radius)
    context.lineTo(x, y + radius)
    context.quadraticCurveTo(x, y, x + radius, y)
    context.closePath()
  }

  function text(value: string, x: number, y: number, size = 13, color = '#f4ead2', align: CanvasTextAlign = 'left') {
    context.fillStyle = color
    context.font = `600 ${size}px sans-serif`
    context.textAlign = align
    context.textBaseline = 'middle'
    context.fillText(value, x, y)
  }

  function drawTile(tile: TileType | null, x: number, y: number, width: number, height: number, selected = false) {
    rounded(x, y, width, height, Math.max(3, width * .1))
    context.fillStyle = selected ? GOLD_HIGHLIGHT : '#f3ede0'
    context.fill()
    context.strokeStyle = selected ? '#fff0b3' : '#9b927e'
    context.lineWidth = 1
    context.stroke()
    const face = tileImage(tile)
    try { context.drawImage(face as unknown as CanvasImageSource, x + 2, y + 2, width - 4, height - 4) } catch { /* 图片仍在解码 */ }
  }

  function drawSeat(index: number, x: number, y: number, active: boolean) {
    if (!snapshot) return
    const player = playerAt(snapshot, index)
    const label = player ? `${PLAYER_WIND[index]} · ${player.name}` : `${PLAYER_WIND[index]} · AI`
    rounded(x - 54, y - 14, 108, 28, 7)
    context.fillStyle = active ? '#476e3d' : PANEL
    context.fill()
    context.strokeStyle = active ? GOLD_HIGHLIGHT : '#55745e'
    context.stroke()
    text(label, x, y - 3, 11, '#f5e9ca', 'center')
    text(player ? String(player.score) : '', x, y + 9, 10, '#b7c8bb', 'center')
  }

  function localCurrentPlayer() {
    if (!snapshot || snapshot.currentPlayer < 0) return -1
    return (snapshot.currentPlayer - snapshot.seat + 4) % 4
  }

  function drawWall(cx: number, cy: number, tableWidth: number, tableHeight: number) {
    const count = snapshot?.wallCount ?? 0
    const tone = count > 0 ? '#2e5b42' : '#193124'
    context.fillStyle = tone
    rounded(cx - tableWidth * .39, cy - tableHeight * .34, tableWidth * .78, 15, 6); context.fill()
    rounded(cx - tableWidth * .39, cy + tableHeight * .34 - 15, tableWidth * .78, 15, 6); context.fill()
    rounded(cx - tableWidth * .42, cy - tableHeight * .3, 15, tableHeight * .6, 6); context.fill()
    rounded(cx + tableWidth * .42 - 15, cy - tableHeight * .3, 15, tableHeight * .6, 6); context.fill()
    text(`剩余 ${count} 张`, cx, cy, 12, '#e8d49b', 'center')
  }

  function drawDiscards(index: number, cx: number, cy: number, tableWidth: number, tableHeight: number) {
    if (!snapshot) return
    const player = playerAt(snapshot, index)
    const tiles = player?.discards ?? []
    const max = Math.min(tiles.length, 18)
    const tileW = Math.max(13, tableWidth * .034)
    const tileH = tileW * 1.35
    for (let offset = 0; offset < max; offset += 1) {
      const row = Math.floor(offset / 6)
      const col = offset % 6
      const direction = index === 0 ? 1 : index === 2 ? -1 : 0
      const side = index === 1 ? 1 : index === 3 ? -1 : 0
      const x = cx + (side ? side * tableWidth * .14 + (row - .5) * tileW * 1.05 : (col - 2.5) * tileW * 1.05)
      const y = cy + (direction ? direction * tableHeight * .17 + row * direction * tileH * .88 : (col - 2.5) * tileH * 1.05)
      drawTile(tiles[offset], x - tileW / 2, y - tileH / 2, tileW, tileH)
    }
  }

  function drawHand() {
    if (!snapshot) return
    const player = playerAt(snapshot, 0)
    const hand = player?.hand ?? []
    const tileH = Math.min(options.height * .19, 92)
    const tileW = tileH * .68
    const gap = Math.min(4, tileW * .08)
    const total = hand.length * tileW + Math.max(0, hand.length - 1) * gap
    const start = Math.max(12, (options.width - total) / 2)
    const y = options.height - tileH - 18
    hand.forEach((tile, index) => {
      const x = start + index * (tileW + gap)
      drawTile(tile, x, y, tileW, tileH, localCurrentPlayer() === 0 && index === player?.drawnTileIndex)
      hitRegions.push({ x, y, width: tileW, height: tileH, action: () => {
        if (localCurrentPlayer() === 0 && !prompt) options.send({ type: 'discard', handIndex: index })
      } })
    })
  }

  function action(label: string, x: number, y: number, callback: () => void, major = false) {
    const width = 56
    rounded(x, y, width, 34, 7)
    context.fillStyle = major ? '#bd5040' : '#294f38'
    context.fill(); context.strokeStyle = major ? '#f3bd89' : GOLD; context.stroke()
    text(label, x + width / 2, y + 17, 16, '#fff5df', 'center')
    hitRegions.push({ x, y, width, height: 34, action: callback })
  }

  function drawActionBar() {
    if (!snapshot) return
    const y = options.height - Math.min(options.height * .19, 92) - 61
    const current = localCurrentPlayer() === 0
    if (current) text('轮到你出牌', options.width / 2, y - 10, 13, '#f1d782', 'center')
    const actions: Array<{ label: string; major?: boolean; send: Record<string, unknown> }> = []
    if (prompt?.kind === 'turn_request') {
      if (prompt.ctx.canHu) actions.push({ label: '胡', major: true, send: { type: 'hu' } })
      if (prompt.ctx.canWindKong) actions.push({ label: '杠', send: { type: 'gang', kind: 'wind' } })
    } else if (prompt?.kind === 'claim_request') {
      if (prompt.ctx.canHu) actions.push({ label: '胡', major: true, send: { type: 'hu' } })
      if (prompt.ctx.canPeng) actions.push({ label: '碰', send: { type: 'claim', action: 'peng' } })
      if (prompt.ctx.canGang) actions.push({ label: '杠', send: { type: 'claim', action: 'gang' } })
      if (prompt.ctx.chiOptions?.length) actions.push({ label: '吃', send: { type: 'claim', action: 'chi', optionIndex: 0 } })
      actions.push({ label: '过', send: { type: 'pass' } })
    } else if (prompt?.kind === 'rob_kong_request') {
      actions.push({ label: '胡', major: true, send: { type: 'hu' } }, { label: '过', send: { type: 'pass' } })
    } else if (current) {
      actions.push({ label: '胡', major: true, send: { type: 'hu' } })
    }
    const start = options.width / 2 - (actions.length * 64 - 8) / 2
    actions.forEach((item, index) => action(item.label, start + index * 64, y, () => {
      options.send(item.send)
      prompt = null
      render()
    }, item.major))
  }

  function render() {
    const { width, height, dpr } = options
    hitRegions = []
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#04120d'; context.fillRect(0, 0, width, height)
    const tableWidth = Math.min(width * .82, height * 1.42)
    const tableHeight = Math.min(height * .66, tableWidth * .72)
    const cx = width / 2
    const cy = height * .46
    rounded(cx - tableWidth / 2 - 13, cy - tableHeight / 2 - 13, tableWidth + 26, tableHeight + 26, 24)
    context.fillStyle = DARK_JADE; context.fill()
    context.strokeStyle = GOLD; context.lineWidth = 5; context.stroke()
    rounded(cx - tableWidth / 2, cy - tableHeight / 2, tableWidth, tableHeight, 18)
    context.fillStyle = JADE; context.fill()
    context.strokeStyle = '#618563'; context.lineWidth = 1; context.stroke()
    drawWall(cx, cy, tableWidth, tableHeight)
    ;[0, 1, 2, 3].forEach((seat) => drawDiscards(seat, cx, cy, tableWidth, tableHeight))
    const active = localCurrentPlayer()
    drawSeat(2, cx, cy - tableHeight / 2 - 37, active === 2)
    drawSeat(1, cx + tableWidth / 2 + 66, cy, active === 1)
    drawSeat(3, cx - tableWidth / 2 - 66, cy, active === 3)
    drawSeat(0, cx, height - 14, active === 0)
    if (snapshot) {
      text(`${snapshot.mode === 'east' ? '东风场' : '半庄场'} · 第 ${snapshot.round} 局`, 18, 24, 13, '#f2dc9c')
      text(`房间 ${snapshot.roomId}`, width - 18, 24, 12, '#b5c6b9', 'right')
      if (snapshot.announcement?.text) text(snapshot.announcement.text, cx, 46, 14, '#f8e5ad', 'center')
    }
    drawHand()
    drawActionBar()
    if (detail) text(detail, cx, 68, 12, '#ffcf9a', 'center')
  }

  function receive(next: ServerSnapshot) { snapshot = next; prompt = null; detail = ''; render() }
  function receiveMessage(message: ServerMessage) {
    if (message.kind === 'state_snapshot') receive(message)
    else if (message.kind === 'turn_request' || message.kind === 'claim_request' || message.kind === 'rob_kong_request') {
      prompt = message
      render()
    }
  }
  function showDetail(next: string) { detail = next; render() }
  function handleTouch(event: WxTouchEvent) {
    const target = point(event)
    if (!target) return false
    const hit = hitRegions.find((region) => target.x >= region.x && target.x <= region.x + region.width && target.y >= region.y && target.y <= region.y + region.height)
    if (!hit) return false
    hit.action(); return true
  }
  return { receive, receiveMessage, render, showDetail, handleTouch, active: () => snapshot !== null }
}
