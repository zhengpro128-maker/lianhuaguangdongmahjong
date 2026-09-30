// Native Canvas history view. Historical profiles and scores always come from
// the record, never the current room occupants.
const FALLBACK_AVATARS = ['lotus', 'ah-lok', 'shisan', 'young-master']
const BIG_HANDS = new Set(['碰碰胡', '清一色', '门前清', '全求人', '七对', '龙七对', '双龙七对', '杠上开花', '抢杠胡'])
const WIN_TYPES = { 'self-draw': '自摸', discard: '点炮胡', 'robbed-kong': '抢杠胡', tianhu: '天胡', dihu: '地胡' }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export const historyScore = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value}` : '—'

export function roundHistoryBadges(record) {
  if (record.draw) return []
  const patterns = (record.details || []).map(detail => String(detail.label || '').replace(/^底分[·・]\s*/, ''))
    .filter(label => BIG_HANDS.has(label))
  if (record.kongBloom) patterns.push('杠上开花')
  if (record.robbedKong || record.winType === 'robbed-kong') patterns.push('抢杠胡')
  if (record.winType === 'tianhu') patterns.push('天胡')
  if (record.winType === 'dihu') patterns.push('地胡')
  return [...new Set(patterns)]
}

export function roundHistoryLayout(width, height, safe = {}) {
  const availableW = width - (safe.left || 0) - (safe.right || 0)
  const availableH = height - (safe.top || 0) - (safe.bottom || 0)
  const w = Math.min(724, availableW - 24), h = Math.min(430, availableH - 20)
  const x = (safe.left || 0) + (availableW - w) / 2, y = (safe.top || 0) + (availableH - h) / 2
  const compact = w < 680 || h < 330, listW = compact ? 150 : 180
  const bodyY = y + 61, bodyH = h - 105
  const pageSize = clamp(Math.floor((bodyH - 31) / 48), 1, 6)
  const list = { x: x + 16, y: bodyY, w: listW, h: bodyH, rowH: (bodyH - 31) / pageSize, pageSize }
  const detail = { x: list.x + listW + 26, y: bodyY, w: w - listW - 58, h: bodyH }
  const heroH = compact ? 43 : 58, badgesH = compact ? 24 : 30, columnsH = 18
  return { x, y, w, h, compact, list, detail, heroH, badgesH, columnsH,
    rowsY: bodyY + heroH + badgesH + columnsH,
    rowH: (bodyH - heroH - badgesH - columnsH) / 4,
    footerY: y + h - 37 }
}

export function roundHistoryView(records, selectedId, page, pageSize) {
  const items = [...(records || [])].reverse()
  let selectedIndex = items.findIndex(record => record.id === selectedId)
  if (selectedIndex < 0) selectedIndex = 0
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = clamp(items.some(record => record.id === selectedId)
    ? Math.floor(selectedIndex / pageSize) : page ?? Math.floor(selectedIndex / pageSize), 0, pages - 1)
  return { items, selectedIndex, selected: items[selectedIndex] || null, pages, page: currentPage,
    visible: items.slice(currentPage * pageSize, (currentPage + 1) * pageSize) }
}

function scoreColor(delta, palette) {
  return delta > 0 ? palette.positive : delta < 0 ? palette.negative : palette.textMuted
}

function fittedText(hud, label, x, y, width, size, color, weight = 'normal', align = 'left') {
  const ctx = hud.ctx
  ctx.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const chars = Array.from(String(label ?? ''))
  let text = chars.join('')
  while (chars.length > 1 && ctx.measureText(text).width > width) { chars.pop(); text = chars.join('') + '…' }
  hud.text(text, x, y, size, color, align, weight)
}

function historyAvatar(hud, entry, x, y, size, palette) {
  const ctx = hud.ctx, fallback = `assets/avatars/${FALLBACK_AVATARS[(entry?.playerIndex ?? 0) % 4]}.png`
  hud.box(x - 1, y - 1, size + 2, size + 2, palette.surface, 'rgba(185,146,73,.5)', 6)
  ctx.save(); hud.box(x, y, size, size, palette.surface, null, 5); ctx.clip()
  if (!hud.image(entry?.avatar || fallback, x, y, size, size)) hud.image(fallback, x, y, size, size)
  ctx.restore()
}

export function drawRoundHistoryEntry(hud, palette, x, y) {
  hud.button(x, y, 72, 28, '', { local: 'round-history' }, { small: true })
  const ctx = hud.ctx
  ctx.save(); ctx.strokeStyle = palette.accent; ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(x + 12, y + 7); ctx.lineTo(x + 12, y + 21); ctx.lineTo(x + 25, y + 21)
  ctx.moveTo(x + 16, y + 17); ctx.lineTo(x + 16, y + 13)
  ctx.moveTo(x + 20, y + 17); ctx.lineTo(x + 20, y + 9)
  ctx.moveTo(x + 24, y + 17); ctx.lineTo(x + 24, y + 5); ctx.stroke(); ctx.restore()
  hud.text('战绩', x + 45, y + 14, 12, palette.accent, 'center', 'bold')
}

export function drawRoundHistory(hud, palette) {
  const b = roundHistoryLayout(hud.width, hud.height, hud.safe), { list, detail } = b
  const view = roundHistoryView(hud.state.roundHistory, hud.historySelectedId, hud.historyPage, list.pageSize)
  hud.historySelectedId = view.selected?.id ?? null; hud.historyPage = view.page
  hud.historyPanel = b
  hud.hits = []; hud.handHits = []
  hud.ctx.fillStyle = 'rgba(0,8,4,.86)'; hud.ctx.fillRect(0, 0, hud.width, hud.height)
  hud.box(b.x, b.y, b.w, b.h, palette.panel, 'rgba(185,146,73,.74)', 14)
  hud.text('本场战绩', b.x + 20, b.y + 25, 20, palette.accent, 'left', 'bold')
  hud.text('整局净输赢 · 含杠分', b.x + 21, b.y + 46, 11, palette.textMuted)
  hud.text(`已完成 ${view.items.length} 局`, b.x + b.w - 68, b.y + 26, 12, palette.textMuted, 'right')
  hud.button(b.x + b.w - 52, b.y + 12, 36, 30, '×', { local: 'close' }, { small: true })
  const ctx = hud.ctx
  ctx.save(); ctx.strokeStyle = 'rgba(185,146,73,.22)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(list.x + list.w + 12, detail.y); ctx.lineTo(list.x + list.w + 12, detail.y + detail.h); ctx.stroke(); ctx.restore()
  if (!view.selected) {
    drawHistoryEmpty(hud, palette, b, hud.state.roundHistoryAvailable === true)
    return
  }
  view.visible.forEach((record, index) => {
    const selected = record.id === view.selected.id, y = list.y + index * list.rowH, height = list.rowH - 6
    const winner = record.scoreChanges?.find(entry => entry.playerIndex === record.winnerIndex)
    hud.box(list.x, y, list.w, height, selected ? palette.surface : palette.panelElevated,
      selected ? palette.accent : 'rgba(185,146,73,.16)', 8)
    if (selected) hud.box(list.x + 1, y + 9, 3, height - 18, palette.accent, null, 2)
    fittedText(hud, record.roundLabel || `第 ${record.round} 局`, list.x + 12, y + 15, list.w - 68, 13, selected ? palette.accent : palette.text, 'bold')
    const delta = winner?.delta
    if (!record.draw) hud.text(historyScore(delta), list.x + list.w - 10, y + 15, 13, scoreColor(delta, palette), 'right', 'bold')
    fittedText(hud, record.draw ? '荒庄 · 无胡牌' : `${winner?.name || record.winner || '胡牌玩家'} · 胡牌`, list.x + 12, y + height - 12, list.w - 24, 11, palette.textMuted)
    hud.hits.push({ x: list.x, y, w: list.w, h: height, action: { local: 'history-select', id: record.id } })
  })
  const pageY = list.y + list.h - 26
  hud.button(list.x, pageY, 33, 25, '‹', { local: 'history-page', step: -1 }, { small: true, disabled: view.page === 0 })
  hud.text(`${view.page + 1} / ${view.pages}`, list.x + list.w / 2, pageY + 13, 11, palette.textMuted, 'center')
  hud.button(list.x + list.w - 33, pageY, 33, 25, '›', { local: 'history-page', step: 1 }, { small: true, disabled: view.page === view.pages - 1 })
  drawHistoryDetail(hud, palette, b, view.selected)
  hud.text(`${view.selected.roundLabel || `第 ${view.selected.round} 局`} · ${view.items.length - view.selectedIndex} / ${view.items.length}`,
    detail.x, b.footerY + 13, 11, palette.textMuted)
  const navW = b.compact ? 70 : 82
  hud.button(detail.x + detail.w - navW * 2 - 8, b.footerY, navW, 27, '上一局', { local: 'history-step', step: 1 },
    { small: true, disabled: view.selectedIndex >= view.items.length - 1 })
  hud.button(detail.x + detail.w - navW, b.footerY, navW, 27, '下一局', { local: 'history-step', step: -1 },
    { small: true, disabled: view.selectedIndex === 0 })
}

function drawHistoryEmpty(hud, palette, b, available) {
  const centerX = b.x + b.w / 2, centerY = b.y + b.h / 2
  hud.box(centerX - 25, centerY - 59, 50, 43, palette.surface, 'rgba(185,146,73,.5)', 8)
  const ctx = hud.ctx
  ctx.save(); ctx.strokeStyle = palette.accent; ctx.lineWidth = 2; ctx.beginPath()
  for (let line = 0; line < 3; line++) { ctx.moveTo(centerX - 13, centerY - 47 + line * 10); ctx.lineTo(centerX + 13 - line * 4, centerY - 47 + line * 10) }
  ctx.stroke(); ctx.restore()
  hud.text(available ? '还没有已完成的对局' : '服务器暂未支持战绩', centerX, centerY + 6, 18, palette.text, 'center', 'bold')
  hud.text(available ? '本场每局结束后，战绩会自动记录在这里' : '更新后端后，新对局会自动保存逐局战绩', centerX, centerY + 35, 12, palette.textMuted, 'center')
}

function drawHistoryDetail(hud, palette, b, record) {
  const { detail: d, heroH, badgesH, rowsY, rowH } = b
  const entries = [...(record.scoreChanges || [])].sort((a, c) => a.playerIndex - c.playerIndex)
  const winner = entries.find(entry => entry.playerIndex === record.winnerIndex)
  const avatar = b.compact ? 35 : 46, heroNameX = d.x + avatar + 12
  if (!record.draw) historyAvatar(hud, winner, d.x + 1, d.y + 2, avatar, palette)
  else {
    hud.box(d.x, d.y + 1, avatar, avatar, palette.surface, 'rgba(185,146,73,.4)', 7)
    hud.text('荒', d.x + avatar / 2, d.y + 1 + avatar / 2, 22, palette.textMuted, 'center', 'bold')
  }
  fittedText(hud, record.draw ? '荒庄' : winner?.name || record.winner || '胡牌玩家', heroNameX, d.y + (b.compact ? 12 : 17),
    d.w - avatar - 125, b.compact ? 16 : 19, palette.text, 'bold')
  const winLabel = record.draw ? '本局无胡牌' : WIN_TYPES[record.winType] || (record.robbedKong ? '抢杠胡' : record.kongBloom ? '杠上开花' : '胡牌')
  hud.text(`${winLabel}${!record.draw && winner?.playerIndex === 0 ? ' · 你' : ''}`, heroNameX, d.y + (b.compact ? 33 : 40), 11, palette.textMuted)
  if (!record.draw) {
    hud.text(historyScore(winner?.delta), d.x + d.w - 1, d.y + (b.compact ? 14 : 21), b.compact ? 25 : 30,
      scoreColor(winner?.delta, palette), 'right', 'bold')
    hud.text('本局净输赢', d.x + d.w - 1, d.y + (b.compact ? 35 : 45), 11, palette.textMuted, 'right')
  }
  const badges = roundHistoryBadges(record)
  if (!badges.length) hud.text(record.draw ? '杠分仍计入本局净输赢' : '普通胡牌', d.x, d.y + heroH + badgesH / 2 - 1, 11, palette.textMuted)
  else {
    // Keep every special pattern readable on short screens; two compact rows
    // fit without compressing characters when several patterns combine.
    const badgeGap = 5, fontSize = 11, rows = [[], []], widths = [0, 0]
    hud.ctx.font = `bold ${fontSize}px "PingFang SC", sans-serif`
    for (const label of badges) {
      const width = hud.ctx.measureText(label).width + 14
      const line = widths[0] + width <= d.w ? 0 : 1
      rows[line].push({ label, width }); widths[line] += width + badgeGap
    }
    rows.forEach((row, line) => {
      let x = d.x, height = rows[1].length ? 13 : Math.min(21, badgesH - 3)
      const y = d.y + heroH + (rows[1].length ? line * 14 : 1)
      row.forEach(({ label, width }) => {
        hud.box(x, y, width, height, 'rgba(185,146,73,.14)', 'rgba(185,146,73,.4)', 4)
        hud.text(label, x + width / 2, y + height / 2, rows[1].length ? 10 : fontSize, palette.accent, 'center', 'bold'); x += width + badgeGap
      })
    })
  }
  const deltaX = d.x + d.w * .70, scoreX = d.x + d.w - 12, columnsY = rowsY - 9
  hud.text('玩家', d.x + 10, columnsY, 11, palette.textMuted)
  hud.text('本局净输赢', deltaX, columnsY, 11, palette.textMuted, 'right')
  hud.text('结束积分', scoreX, columnsY, 11, palette.textMuted, 'right')
  entries.forEach((entry, index) => {
    const y = rowsY + index * rowH, height = rowH - 3, isWinner = !record.draw && entry.playerIndex === record.winnerIndex
    hud.box(d.x, y, d.w, height, isWinner ? palette.surface : palette.panelElevated,
      isWinner ? 'rgba(185,146,73,.55)' : null, 6)
    const side = Math.min(28, height - 6), ax = d.x + 6, ay = y + (height - side) / 2
    historyAvatar(hud, entry, ax, ay, side, palette)
    const name = `${entry.name || '玩家'}${entry.playerIndex === 0 ? '（你）' : ''}`
    const centerY = y + height / 2, nameX = ax + side + 9, nameW = d.w * .47 - side - 21
    fittedText(hud, name, nameX, centerY, nameW, 12, isWinner ? palette.accent : palette.text, isWinner ? 'bold' : 'normal')
    hud.text(historyScore(entry.delta), deltaX, centerY, b.compact ? 16 : 18, scoreColor(entry.delta, palette), 'right', 'bold')
    hud.text(Number.isFinite(entry.score) ? entry.score : '—', scoreX, centerY, b.compact ? 14 : 16, palette.text, 'right', 'bold')
  })
}
