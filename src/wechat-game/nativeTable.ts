import { tileAudioFile, tileFaceFile } from '../game/core/rules/tiles'
import type { ServerSnapshot } from '../game/online/protocol/dto'
import type { ServerMessage } from '../game/online/protocol/messages'
import type { TileType } from '../game/core/contracts/types'
import type { WxGameApi, WxImageLike, WxTouchEvent } from './wx'
import type { TableThemeName } from '../theme/themeIdentity'

/**
 * 小游戏原生牌桌。
 *
 * 这不是另一套皮肤：颜色、牌背、牌面和四席桌面结构均取自浏览器版的
 * MahjongTable3D / GameTableHud。小游戏没有 DOM/Vue 层，因而把同一套资产
 * 和布局映射至原生 Canvas；联机状态仍只消费服务端 state_snapshot。
 */
interface HitRegion { x: number; y: number; width: number; height: number; action: () => void }

interface NativeTheme {
  background: string
  surface: string
  border: string
  accent: string
  panel: string
  active: string
  tileBack: string
}

const GOLD_HIGHLIGHT = '#e1b85d'
const PLAYER_WIND = ['东', '南', '西', '北']
const THEMES: Record<TableThemeName, NativeTheme> = {
  jade: { background: '#04120d', surface: '#254223', border: '#08271c', accent: '#caa24c', panel: 'rgba(7,31,23,.92)', active: '#476e3d', tileBack: '#2b8d39' },
  happyMahjong: { background: '#201009', surface: '#bb2d22', border: '#5b120f', accent: '#f5cc62', panel: 'rgba(72,15,12,.92)', active: '#d85432', tileBack: '#cf3128' },
  rosewood: { background: '#170905', surface: '#6e2f1e', border: '#3c160d', accent: '#d7af58', panel: 'rgba(45,18,11,.94)', active: '#8e4931', tileBack: '#76321f' },
  llm: { background: '#050b17', surface: '#142842', border: '#07111f', accent: '#5ad5ef', panel: 'rgba(7,18,34,.94)', active: '#24537a', tileBack: '#215273' },
  llmAnime: { background: '#171124', surface: '#4a315e', border: '#261a35', accent: '#f4b8e4', panel: 'rgba(35,23,49,.94)', active: '#71507f', tileBack: '#6b477e' },
}

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
  onReturnToRoom?: () => void
}) {
  const { wx, context } = options
  const images = new Map<string, WxImageLike>()
  let snapshot: ServerSnapshot | null = null
  let prompt: Extract<ServerMessage, { kind: 'turn_request' | 'claim_request' | 'rob_kong_request' }> | null = null
  let hitRegions: HitRegion[] = []
  let detail = ''
  let themeName: TableThemeName = 'jade'
  let selectedIndex = -1
  let continueReady = false
  let finalScores: Array<{ seat: number; name: string; score: number }> | null = null
  let lastDiscardAudioId = -1
  let lastResultKey = ''

  function playAudio(fileName: string | null | undefined, volume = .8) {
    if (!fileName || !wx.createInnerAudioContext) return
    const audio = wx.createInnerAudioContext()
    audio.src = `audio/${fileName}`
    audio.volume = volume
    audio.loop = false
    audio.play()
    setTimeout(() => audio.destroy(), 5000)
  }

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
    context.fillStyle = tile ? (selected ? GOLD_HIGHLIGHT : '#f3ede0') : THEMES[themeName].tileBack
    context.fill()
    context.strokeStyle = selected ? '#fff0b3' : '#9b927e'
    context.lineWidth = 1
    context.stroke()
    if (tile) {
      const face = tileImage(tile)
      try { context.drawImage(face as unknown as CanvasImageSource, x + 2, y + 2, width - 4, height - 4) } catch { /* 图片仍在解码 */ }
    } else {
      context.strokeStyle = 'rgba(255,255,255,.22)'
      context.strokeRect(x + width * .22, y + height * .18, width * .56, height * .64)
    }
  }

  function drawSeat(index: number, x: number, y: number, active: boolean) {
    if (!snapshot) return
    const player = playerAt(snapshot, index)
    const label = player ? `${PLAYER_WIND[index]} · ${player.name}` : `${PLAYER_WIND[index]} · AI`
    rounded(x - 54, y - 14, 108, 28, 7)
    context.fillStyle = active ? THEMES[themeName].active : THEMES[themeName].panel
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

  function drawMelds(index: number, cx: number, cy: number, tableWidth: number, tableHeight: number) {
    if (!snapshot) return
    const melds = playerAt(snapshot, index)?.melds ?? []
    const flattened = melds.flatMap((meld) => meld.tiles)
    const tileW = Math.max(12, tableWidth * .03)
    const tileH = tileW * 1.35
    flattened.slice(0, 16).forEach((tile, offset) => {
      if (index === 0 || index === 2) {
        const direction = index === 0 ? 1 : -1
        drawTile(tile, cx - tableWidth * .43 + offset * tileW * 1.04, cy + direction * tableHeight * .38 - tileH / 2, tileW, tileH)
      } else {
        const direction = index === 1 ? 1 : -1
        drawTile(tile, cx + direction * tableWidth * .44 - tileW / 2, cy - tableHeight * .38 + offset * tileH * 1.04, tileW, tileH)
      }
    })
  }

  function drawOpponentHands(cx: number, cy: number, tableWidth: number, tableHeight: number) {
    if (!snapshot) return
    for (const index of [1, 2, 3]) {
      const count = playerAt(snapshot, index)?.hand.length ?? 0
      const tileW = Math.max(10, tableWidth * .025)
      const tileH = tileW * 1.35
      for (let offset = 0; offset < count; offset += 1) {
        if (index === 2) {
          drawTile(null, cx + (count / 2 - offset) * tileW * .76, cy - tableHeight * .43, tileW, tileH)
        } else {
          const x = cx + (index === 1 ? 1 : -1) * tableWidth * .46 - tileW / 2
          drawTile(null, x, cy + (offset - count / 2) * tileW * .76, tileW, tileH)
        }
      }
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
      const selected = index === selectedIndex
      drawTile(tile, x, y - (selected ? 10 : 0), tileW, tileH, selected || (localCurrentPlayer() === 0 && index === player?.drawnTileIndex))
      hitRegions.push({ x, y, width: tileW, height: tileH, action: () => {
        if (localCurrentPlayer() !== 0 || prompt?.kind !== 'turn_request') return
        if (selectedIndex !== index) {
          selectedIndex = index
          render()
          return
        }
        options.send({ type: 'discard', handIndex: index })
        selectedIndex = -1
        prompt = null
        detail = '已出牌，等待服务端确认…'
        render()
      } })
    })
  }

  function action(label: string, x: number, y: number, callback: () => void, major = false) {
    const width = 56
    rounded(x, y, width, 34, 7)
    context.fillStyle = major ? '#bd5040' : '#294f38'
    context.fill(); context.strokeStyle = major ? '#f3bd89' : THEMES[themeName].accent; context.stroke()
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
      const me = playerAt(snapshot, 0)
      const counts = new Map<TileType, number>()
      for (const tile of me?.hand ?? []) if (tile) counts.set(tile, (counts.get(tile) ?? 0) + 1)
      const concealed = [...counts].find(([, count]) => count >= 4)?.[0]
      const added = me?.melds.find((meld) => meld.type === 'peng' && counts.has(meld.tile))?.tile
      const kong = added ?? concealed
      if (kong) actions.push({ label: '杠', send: { type: 'gang', kind: added ? 'added' : 'concealed', tile: kong } })
    } else if (prompt?.kind === 'claim_request') {
      if (prompt.ctx.canHu) actions.push({ label: '胡', major: true, send: { type: 'hu' } })
      if (prompt.ctx.canPeng) actions.push({ label: '碰', send: { type: 'claim', action: 'peng' } })
      if (prompt.ctx.canGang) actions.push({ label: '杠', send: { type: 'claim', action: 'gang' } })
      const chiOptions = prompt.ctx.chiOptions ?? []
      chiOptions.forEach((_, optionIndex) => actions.push({
        label: chiOptions.length > 1 ? `吃${optionIndex + 1}` : '吃',
        send: { type: 'claim', action: 'chi', optionIndex },
      }))
      actions.push({ label: '过', send: { type: 'pass' } })
    } else if (prompt?.kind === 'rob_kong_request') {
      actions.push({ label: '胡', major: true, send: { type: 'hu' } }, { label: '过', send: { type: 'pass' } })
    }
    if (continueReady || snapshot.phase === 'settled' || snapshot.phase === 'finished') {
      actions.push({ label: snapshot.matchFinished ? '返回' : '下一局', major: true, send: snapshot.matchFinished
        ? { type: 'return_to_lobby' }
        : { type: 'continue', presentationKey: snapshot.result?.presentationKey } })
    }
    const start = options.width / 2 - (actions.length * 64 - 8) / 2
    actions.forEach((item, index) => action(item.label, start + index * 64, y, () => {
      if (item.send.type === 'return_to_lobby') {
        snapshot = null
        prompt = null
        finalScores = null
        continueReady = false
        options.onReturnToRoom?.()
        return
      }
      options.send(item.send)
      prompt = null
      continueReady = false
      render()
    }, item.major))
  }

  function render() {
    const { width, height, dpr } = options
    hitRegions = []
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    const theme = THEMES[themeName]
    context.fillStyle = theme.background; context.fillRect(0, 0, width, height)
    const tableWidth = Math.min(width * .82, height * 1.42)
    const tableHeight = Math.min(height * .66, tableWidth * .72)
    const cx = width / 2
    const cy = height * .46
    rounded(cx - tableWidth / 2 - 13, cy - tableHeight / 2 - 13, tableWidth + 26, tableHeight + 26, 24)
    context.fillStyle = theme.border; context.fill()
    context.strokeStyle = theme.accent; context.lineWidth = 5; context.stroke()
    rounded(cx - tableWidth / 2, cy - tableHeight / 2, tableWidth, tableHeight, 18)
    context.fillStyle = theme.surface; context.fill()
    context.strokeStyle = '#618563'; context.lineWidth = 1; context.stroke()
    drawWall(cx, cy, tableWidth, tableHeight)
    drawOpponentHands(cx, cy, tableWidth, tableHeight)
    ;[0, 1, 2, 3].forEach((seat) => drawDiscards(seat, cx, cy, tableWidth, tableHeight))
    ;[0, 1, 2, 3].forEach((seat) => drawMelds(seat, cx, cy, tableWidth, tableHeight))
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
    if (snapshot?.result || finalScores) drawSettlement()
    else {
      drawHand()
      drawActionBar()
      if (detail) text(detail, cx, 68, 12, '#ffcf9a', 'center')
    }
  }

  function drawSettlement() {
    if (!snapshot) return
    const panelWidth = Math.min(430, options.width * .7)
    const panelHeight = Math.min(270, options.height * .62)
    const x = (options.width - panelWidth) / 2
    const y = (options.height - panelHeight) / 2
    rounded(x, y, panelWidth, panelHeight, 16)
    context.fillStyle = 'rgba(3,12,9,.94)'; context.fill()
    context.strokeStyle = THEMES[themeName].accent; context.lineWidth = 2; context.stroke()
    const result = snapshot.result
    text(finalScores ? '本场结算' : result?.draw ? '本局流局' : `${result?.winner ?? '玩家'} 胡牌`, options.width / 2, y + 35, 22, '#f4df9f', 'center')
    const rows = finalScores ?? result?.scoreChanges?.map((item) => ({ seat: item.playerIndex, name: item.name, score: item.score })) ?? []
    rows.slice(0, 4).forEach((row, index) => {
      const delta = result?.scoreChanges?.find((item) => item.playerIndex === row.seat)?.delta
      text(row.name, x + 38, y + 76 + index * 32, 14)
      text(`${row.score} 分${delta === undefined ? '' : `  ${delta >= 0 ? '+' : ''}${delta}`}`, x + panelWidth - 38, y + 76 + index * 32, 14, delta !== undefined && delta < 0 ? '#e99889' : '#bde2bb', 'right')
    })
    if (!rows.length && result?.details?.length) {
      result.details.slice(0, 4).forEach((item, index) => text(`${item.label}${item.multiplier ? ` ×${item.multiplier}` : ''}`, options.width / 2, y + 78 + index * 28, 13, '#d9ccae', 'center'))
    }
    const finished = Boolean(finalScores || snapshot.matchFinished)
    action(finished ? '返回' : '下一局', options.width / 2 - 28, y + panelHeight - 48, () => {
      if (finished) {
        snapshot = null
        prompt = null
        finalScores = null
        continueReady = false
        options.onReturnToRoom?.()
      } else {
        options.send({ type: 'continue', presentationKey: snapshot?.result?.presentationKey })
        continueReady = false
        detail = '已确认，等待其他玩家…'
        render()
      }
    }, true)
  }

  function receive(next: ServerSnapshot) {
    if (next.lastDiscard && next.lastDiscard.id !== lastDiscardAudioId) {
      lastDiscardAudioId = next.lastDiscard.id
      playAudio(tileAudioFile(next.lastDiscard.tile))
    }
    const resultKey = next.result?.presentationKey ?? ''
    if (resultKey && resultKey !== lastResultKey) {
      lastResultKey = resultKey
      playAudio(next.result?.winType === 'self-draw' ? 'zimo.mp3' : 'hu.mp3')
    }
    snapshot = next
    selectedIndex = -1
    if (next.phase !== 'prompt' && next.phase !== 'discard') prompt = null
    if (!next.result) finalScores = null
    detail = next.announcement?.text ?? ''
    render()
  }
  function receiveMessage(message: ServerMessage) {
    if (message.kind === 'state_snapshot') receive(message)
    else if (message.kind === 'turn_request' || message.kind === 'claim_request' || message.kind === 'rob_kong_request') {
      prompt = message
      selectedIndex = -1
      detail = message.kind === 'turn_request' ? '轮到你出牌：点一次选牌，再点一次打出' : '请选择操作'
      if (snapshot) render()
    }
    else if (message.kind === 'announcement') { detail = message.text; if (snapshot) render() }
    else if (message.kind === 'llm_message') { detail = message.text; if (snapshot) render() }
    else if (message.kind === 'round_start') { playAudio('game_start.mp3'); if (snapshot) render() }
    else if (message.kind === 'table_action') {
      const sounds: Partial<Record<typeof message.event.type, string>> = {
        peng: 'peng.mp3', chi: 'chi.mp3', 'discard-gang': 'gang.mp3',
        'concealed-gang': 'gang.mp3', 'added-gang': 'gang.mp3', 'flower-gang': 'gang.mp3',
        'wind-kong': 'gang.mp3',
      }
      playAudio(sounds[message.event.type]); if (snapshot) render()
    }
    else if (message.kind === 'continue_prompt') { continueReady = true; detail = `已有 ${message.total} 位玩家确认`; if (snapshot) render() }
    else if (message.kind === 'match_finished') { finalScores = message.finalScores; continueReady = true; if (snapshot) render() }
    else if (message.kind === 'table_theme') { themeName = message.theme; if (snapshot) render() }
    else if (message.kind === 'error' || message.kind === 'rejoin_err') { showDetail(`服务器提示：${message.code}`) }
  }
  function showDetail(next: string) { detail = next; if (snapshot) render() }
  function handleTouch(event: WxTouchEvent) {
    const target = point(event)
    if (!target) return false
    const hit = hitRegions.find((region) => target.x >= region.x && target.x <= region.x + region.width && target.y >= region.y && target.y <= region.y + region.height)
    if (!hit) return false
    hit.action(); return true
  }
  return {
    receive,
    receiveMessage,
    render,
    showDetail,
    handleTouch,
    setTheme(next: TableThemeName) { themeName = next; if (snapshot) render() },
    reset() { snapshot = null; prompt = null; finalScores = null; continueReady = false },
    active: () => snapshot !== null,
  }
}
