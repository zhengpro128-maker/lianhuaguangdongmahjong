import { describe, it, expect, vi } from 'vitest'
import { MiniHud } from '../src/hud.js'
import { roundHistoryBadges, roundHistoryLayout, roundHistoryView } from '../src/round-history.js'
import { THEME_PRESENTATIONS } from '../../src/theme/themePresentation.ts'

const palette = THEME_PRESENTATIONS.jade.palette
const players = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `当前昵称${seat}`, avatar: `https://current.test/${seat}.png`,
  score: 1200, hand: seat === 0 ? ['m1', 'm2', 'm3'] : [] }))
const history = Array.from({ length: 9 }, (_, index) => ({ id: `round-${index + 1}`, round: index + 1, roundLabel: `第 ${index + 1} 局`,
  dealer: 0, honba: 0, winnerIndex: 1, winner: '历史赢家', winType: 'self-draw', totalWon: 150,
  details: [{ label: '底分·清一色', points: 12 }, { label: '门前清', multiplier: 2 }, { label: '硬胡', multiplier: 2 }],
  scoreChanges: [2, 0, 3, 1].map(seat => ({ playerIndex: seat, name: seat === 1 ? '历史赢家' : `历史玩家${seat}`,
    avatar: `https://history.test/${seat}.png`, score: 1000 + [0, 105, -65, -40][seat], delta: [0, 105, -65, -40][seat] })) }))
const online = { phase: 'discard', screen: 'game', online: { roomId: 'ABC234', status: 'connected' },
  players, user: players[0], selectedIndex: 0, isUserTurn: true, roundHistory: history, roundHistoryAvailable: true }
function setup(width = 844, height = 390, system = {}) {
  const gradient = { addColorStop() {} }, ctx = new Proxy({ fillText: vi.fn(), drawImage: vi.fn(),
    measureText: text => ({ width: [...String(text)].length * 7 }), createLinearGradient: () => gradient,
    createRadialGradient: () => gradient }, { get: (target, key) => target[key] ?? (() => {}) })
  const onAction = vi.fn(), hud = new MiniHud({ createCanvas: () => ({ getContext: () => ctx }), createImage: () => ({}), onAction })
  hud.resize({ windowWidth: width, windowHeight: height, ...system }); hud.update(online)
  const text = vi.spyOn(hud, 'text'), box = vi.spyOn(hud, 'box')
  return { hud, ctx, onAction, text, box }
}
const tap = (hud, action) => {
  const hit = hud.hitRegions.find(hit => Object.entries(action).every(([key, value]) => hit.action[key] === value))
  expect(hit, JSON.stringify(action)).toBeTruthy(); hud.handleTouch(hit.x + hit.w / 2, hit.y + hit.h / 2)
}
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

describe('online round history HUD', () => {
  it('opens empty history, hides its entry in local play and beneath settlement, and returns after revealing the table', () => {
    const { hud, ctx } = setup()
    hud.update({ ...online, roundHistory: [] }); tap(hud, { local: 'round-history' })
    expect(ctx.fillText.mock.calls.some(([label]) => label === '还没有已完成的对局')).toBe(true)
    tap(hud, { local: 'close' })
    hud.update({ ...online, online: null })
    expect(hud.hitRegions.some(hit => hit.action.local === 'round-history')).toBe(false)
    hud.update({ ...online, phase: 'settled', result: history[0] })
    expect(hud.hitRegions.some(hit => hit.action.local === 'round-history')).toBe(false)
    tap(hud, { local: 'hide-result' })
    expect(hud.hitRegions.some(hit => hit.action.local === 'round-history')).toBe(true)
    tap(hud, { local: 'round-history' }); expect(hud.historySelectedId).toBe('round-9')
  })

  it('explains unavailable older servers and does not offer table actions through the overlay', () => {
    const { hud, ctx, onAction } = setup()
    const hand = hud.handHits[0]
    hud.update({ ...online, roundHistory: [], roundHistoryAvailable: false }); tap(hud, { local: 'round-history' })
    expect(ctx.fillText.mock.calls.some(([label]) => label === '服务器暂未支持战绩')).toBe(true)
    expect(hud.handHits).toHaveLength(0)
    hud.handleTouch(hand.x + hand.w / 2, hand.y + hand.h / 2)
    expect(hud.handleSwipe(hand.x, hand.y, hand.x, hand.y - 60)).toBe(false)
    hud.handleTouch(0, 0)
    expect(onAction).not.toHaveBeenCalled(); expect(hud.modal).toBe('round-history')
  })

  it('uses immutable historical profiles, winner net change rather than hand payment, and distinct loss/zero colors', () => {
    const { hud, ctx, text } = setup()
    tap(hud, { local: 'round-history' })
    for (const entry of hud.images.values()) entry.ready = true
    ctx.drawImage.mockClear(); text.mockClear(); hud.drawModal()
    const avatarSources = ctx.drawImage.mock.calls.map(([image]) => image.src)
    expect(avatarSources).toEqual(['https://history.test/1.png', 'https://history.test/0.png',
      'https://history.test/1.png', 'https://history.test/2.png', 'https://history.test/3.png'])
    const labels = text.mock.calls.map(([label]) => String(label))
    expect(labels).toContain('历史赢家'); expect(labels).not.toContain('+150')
    expect(labels).toContain('+105'); expect(labels.some(label => label.startsWith('当前昵称'))).toBe(false)
    expect(text.mock.calls.some(([label, , , , color]) => label === '-65' && color === palette.negative)).toBe(true)
    expect(text.mock.calls.some(([label, , , , color]) => label === '0' && color === palette.textMuted)).toBe(true)
    expect(labels).toContain('结束积分'); expect(labels).toContain('1105')
    // Rendering must not reorder the authoritative scoreChanges array.
    expect(history[8].scoreChanges.map(entry => entry.playerIndex)).toEqual([2, 0, 3, 1])
  })

  it('pages newest first, navigates adjacent rounds, and retains selection when another round arrives', () => {
    const { hud, onAction } = setup(667, 320)
    tap(hud, { local: 'round-history' })
    expect(hud.hitRegions.filter(hit => hit.action.local === 'history-select').map(hit => hit.action.id)).toEqual(['round-9', 'round-8', 'round-7'])
    tap(hud, { local: 'history-page', step: 1 }); expect(hud.historySelectedId).toBe('round-6')
    tap(hud, { local: 'history-select', id: 'round-4' }); expect(hud.historySelectedId).toBe('round-4')
    tap(hud, { local: 'history-step', step: 1 }); expect(hud.historySelectedId).toBe('round-3'); expect(hud.historyPage).toBe(2)
    tap(hud, { local: 'history-step', step: -1 }); expect(hud.historySelectedId).toBe('round-4')
    const next = { ...history[8], id: 'round-10', round: 10, roundLabel: '第 10 局' }
    hud.update({ ...online, roundHistory: [...history, next] })
    expect(hud.historySelectedId).toBe('round-4'); expect(hud.historyPage).toBe(2)
    expect(hud.hitRegions.some(hit => hit.action.id === 'round-4')).toBe(true)
    tap(hud, { local: 'close' }); expect(hud.handHits).toHaveLength(3); expect(onAction).not.toHaveBeenCalled()
  })

  it('handles a draw without inventing a winner while retaining kong score changes', () => {
    const { hud, text } = setup()
    hud.update({ ...online, roundHistory: [{ ...history[0], draw: true, winnerIndex: undefined, winner: '荒庄' }] })
    tap(hud, { local: 'round-history' })
    expect(text.mock.calls.some(([label]) => label === '本局无胡牌')).toBe(true)
    expect(text.mock.calls.some(([label, , , size]) => label === '本局净输赢' && size === 11)).toBe(true)
    expect(text.mock.calls.some(([label, , , size]) => label === '+105' && size >= 25)).toBe(false)
    expect(text.mock.calls.some(([label]) => label === '-65')).toBe(true)
  })

  it.each([[667, 320], [844, 390]])('keeps the history control and all panel content inside safe bounds at %s×%s', (width, height) => {
    const menu = { left: width - 130, right: width - 12, top: 10, bottom: 42 }
    const { hud, text } = setup(width, height, { safeArea: { left: 40, right: width - 40, top: 0, bottom: height - 20 }, menuButton: menu })
    const entry = hud.hitRegions.find(hit => hit.action.local === 'round-history')
    const capsule = { x: menu.left, y: menu.top, w: menu.right - menu.left, h: menu.bottom - menu.top }
    for (const card of hud.layout.seats) expect(overlaps(entry, card)).toBe(false)
    for (const hit of hud.hitRegions.filter(hit => hit !== entry)) expect(overlaps(entry, hit)).toBe(false)
    expect(overlaps(entry, hud.layout.indicator)).toBe(false); expect(overlaps(entry, capsule)).toBe(false)
    tap(hud, { local: 'round-history' }); text.mockClear(); hud.drawModal()
    const b = hud.historyPanel
    for (const hit of hud.hitRegions) {
      expect(hit.x).toBeGreaterThanOrEqual(40); expect(hit.x + hit.w).toBeLessThanOrEqual(width - 40)
      expect(hit.y).toBeGreaterThanOrEqual(0); expect(hit.y + hit.h).toBeLessThanOrEqual(height - 20)
    }
    expect(text.mock.calls.filter(([label]) => /历史玩家|历史赢家/.test(label) && !String(label).includes('胡牌')).length).toBe(5)
    expect(b.rowsY + b.rowH * 4).toBeLessThanOrEqual(b.footerY)
    for (const [, , y, size] of text.mock.calls) {
      expect(y - size / 2).toBeGreaterThanOrEqual(b.y); expect(y + size / 2).toBeLessThanOrEqual(b.y + b.h)
    }
  })
})

describe('history special-hand badges', () => {
  it('recognizes each Wuhan big hand and special win without treating scoring modifiers as patterns', () => {
    const names = ['碰碰胡', '清一色', '门前清', '全求人', '七对', '龙七对', '双龙七对', '杠上开花', '抢杠胡']
    for (const name of names) expect(roundHistoryBadges({ details: [{ label: `底分·${name}` }] })).toEqual([name])
    expect(roundHistoryBadges({ details: ['底分·屁胡', '大胡自摸', '硬胡', '软胡', '杠番·暗杠', '杠上开花减一番'].map(label => ({ label })) })).toEqual([])
    expect(roundHistoryBadges({ kongBloom: true, robbedKong: true, details: [{ label: '底分·杠上开花' }] })).toEqual(['杠上开花', '抢杠胡'])
    expect(roundHistoryBadges({ winType: 'tianhu' })).toEqual(['天胡'])
    expect(roundHistoryBadges({ draw: true, kongBloom: true })).toEqual([])
  })

  it('keeps a selected record on its page even when new records push it across a page boundary', () => {
    const size = roundHistoryLayout(667, 320).list.pageSize
    const view = roundHistoryView([...history, { ...history[0], id: 'round-10' }], 'round-4', 1, size)
    expect(view.page).toBe(2); expect(view.visible.some(record => record.id === 'round-4')).toBe(true)
  })
})
