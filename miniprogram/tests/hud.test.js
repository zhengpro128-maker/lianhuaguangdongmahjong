import { describe, it, expect, vi } from 'vitest'
import { MiniHud } from '../src/hud.js'

function makeHud() {
  const gradient = { addColorStop() {} }
  const ctx = new Proxy({ fillText: vi.fn(), measureText: text => ({ width: text.length * 7 }), createLinearGradient: () => gradient,
    createRadialGradient: () => gradient }, { get: (target, key) => target[key] ?? (() => {}) })
  const canvas = { getContext: () => ctx }, onAction = vi.fn(), onInvalidate = vi.fn()
  const hud = new MiniHud({ createCanvas: () => canvas, createImage: () => ({}), onAction, onInvalidate })
  hud.resize({ windowWidth: 844, windowHeight: 390, pixelRatio: 3 })
  return { hud, onAction, onInvalidate, canvas }
}
const players = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `玩家${seat}`, score: 1000,
  hand: seat === 0 ? ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'green', 'green', 'white', 'white', 'red'] : [], drawnTileIndex: 13 }))
const turn = { phase: 'discard', screen: 'game', isUserTurn: true, selectedIndex: -1, user: players[0], players,
  dealer: 0, currentPlayer: 0, jokerTiles: ['white'], actions: [{ id: 'discard', type: 'discard', label: '出牌' }] }
const tap = (hud, hit) => hud.handleTouch(hit.x + hit.w / 2, hit.y + hit.h / 2)

describe('native HUD interaction', () => {
  it('scales pixels while hit testing uses logical coordinates, and requires selection before a second tap discards', () => {
    const { hud, onAction, canvas } = makeHud()
    expect(canvas.width).toBe(1688)
    hud.update(turn)
    const first = hud.handHits[0]
    tap(hud, first)
    expect(onAction).toHaveBeenLastCalledWith({ type: 'select', index: 0 })
    hud.update({ ...turn, selectedIndex: 0 })
    tap(hud, hud.handHits[0])
    expect(onAction).toHaveBeenLastCalledWith({ type: 'discard', index: 0 })
    expect(hud.handHits[0].y).toBeLessThan(first.y)
  })

  it('allows a direct upward swipe of red/joker tiles so their special kongs remain playable', () => {
    const { hud, onAction } = makeHud(); hud.update(turn)
    for (const index of [11, 13]) {
      const hit = hud.handHits[index], x = hit.x + hit.w / 2, y = hit.y + hit.h / 2
      expect(hud.handleSwipe(x, y, x + 3, y - 50)).toBe(true)
      expect(onAction).toHaveBeenLastCalledWith({ type: 'discard', index })
    }
    hud.update({ ...turn, isUserTurn: false })
    const hit = hud.handHits[0]
    onAction.mockClear(); tap(hud, hit)
    expect(hud.handleSwipe(hit.x, hit.y, hit.x, hit.y - 50)).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('blocks the table beneath a modal and requires a deliberate exit confirmation', () => {
    const { hud, onAction } = makeHud(); hud.update(turn)
    const hand = hud.handHits[0]
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'leave'))
    tap(hud, hand)
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'lobby'))
    expect(onAction).toHaveBeenCalledWith({ type: 'lobby' })
  })

  it('offers a confirmed manual exit from both the online room and an active online match', () => {
    const { hud, onAction } = makeHud()
    const online = { roomId: 'ABC123', status: 'connected', mySeat: 0, isCreator: true,
      seats: players.map((player, seat) => ({ seat, nickname: player.name, ready: seat === 0 })) }
    hud.update({ ...turn, phase: 'lobby', screen: 'lobby', online, onlineBusy: false })
    expect(hud.hitRegions.filter(hit => hit.action.local === 'leave-online')).toHaveLength(2)
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'leave-online'))
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'leave-room'))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'leave-room' })

    onAction.mockClear()
    hud.update({ ...turn, online })
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'leave-online'))
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'leave-room'))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'leave-room' })
  })

  it('shows joinable rooms in the lobby and exposes room sharing after joining', () => {
    const { hud, onAction } = makeHud()
    hud.update({ ...turn, phase: 'lobby', screen: 'lobby', lobbyPage: 'online', identity: { nickname: '小明', displayId: '12345678' },
      roomList: [
        { roomId: 'ABC234', mode: 'east', rulesetId: 'wuhan-huanghuang', occupied: 2, capacity: 4 },
        { roomId: 'DEF567', mode: 'hanchan', rulesetId: 'wuhan-huanghuang', occupied: 1, capacity: 4 },
      ], onlineBusy: false })
    const listed = hud.hitRegions.find(hit => hit.action.type === 'join-listed-room' && hit.action.roomId === 'ABC234')
    expect(listed).toBeTruthy()
    tap(hud, listed)
    expect(onAction).toHaveBeenLastCalledWith({ type: 'join-listed-room', roomId: 'ABC234' })

    const online = { roomId: 'ABC234', status: 'connected', mySeat: 0, isCreator: true,
      seats: players.map((player, seat) => ({ seat, nickname: player.name, ready: seat === 0 })) }
    hud.update({ ...turn, phase: 'lobby', screen: 'lobby', online, onlineBusy: false })
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'share-room'))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'share-room' })
  })

  it('offers a confirmed exit for a saved online room from the home lobby', () => {
    const { hud, onAction } = makeHud()
    hud.update({ ...turn, phase: 'lobby', screen: 'lobby', lobbyPage: 'online', canResume: true,
      identity: { nickname: '小明', displayId: '12345678' }, roomList: [], onlineBusy: false })
    expect(hud.hitRegions.some(hit => hit.action.type === 'create-room')).toBe(false)
    expect(hud.hitRegions.some(hit => hit.action.type === 'join-room')).toBe(false)
    expect(hud.hitRegions.some(hit => hit.action.type === 'resume-room')).toBe(true)
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'leave-saved-online'))
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'leave-room'))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'leave-room' })
  })

  it('keeps room rows and local controls separate on short landscape screens', () => {
    const { hud } = makeHud()
    hud.resize({ windowWidth: 667, windowHeight: 320, pixelRatio: 2 })
    const roomList = ['ABC234', 'DEF567', 'GHJ789', 'KLM234'].map((roomId, index) => ({
      roomId, mode: index % 2 ? 'hanchan' : 'east', rulesetId: 'wuhan-huanghuang', occupied: index + 1, capacity: 4,
    }))
    hud.update({ ...turn, phase: 'lobby', screen: 'lobby', lobbyPage: 'online', identity: { nickname: '小明', displayId: '12345678' }, roomList })
    const rooms = hud.hitRegions.filter(hit => hit.action.type === 'join-listed-room')
    expect(rooms).toHaveLength(4)
    expect(Math.max(...rooms.map(hit => hit.y + hit.h))).toBeLessThan(320)
    expect(hud.hitRegions.some(hit => hit.action.type === 'start')).toBe(false)
    hud.update({ phase: 'lobby', lobbyPage: 'local', selectedMatch: 'rounds4' })
    const matches = hud.hitRegions.filter(hit => hit.action.type === 'match')
    expect(matches.map(hit => hit.action.value)).toEqual(['rounds4', 'rounds8', 'rounds16'])
    const start = hud.hitRegions.find(hit => hit.action.type === 'start')
    expect(Math.max(...matches.map(hit => hit.y + hit.h))).toBeLessThan(start.y)
  })

  it('presents multiple chi combinations before submitting the selected index', () => {
    const { hud, onAction } = makeHud()
    const chiOptions = [{ tiles: ['m1', 'm2', 'm3'] }, { tiles: ['m2', 'm3', 'm4'] }]
    hud.update({ ...turn, phase: 'prompt', isUserTurn: false, actionPrompt: { chiOptions },
      actions: chiOptions.map((option, optionIndex) => ({ type: 'chi', id: `chi:${optionIndex}`, label: '吃', optionIndex, tiles: option.tiles })) })
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'chi'))
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.optionIndex === 1))
    expect(onAction).toHaveBeenCalledWith({ type: 'action', id: 'chi', optionIndex: 1 })
  })

  it('viewing the revealed table does not advance the round, and continue submits once', () => {
    const { hud, onAction } = makeHud()
    hud.update({ ...turn, phase: 'settled', isUserTurn: false, result: { draw: true,
      scoreChanges: players.map(player => ({ playerIndex: player.seat, name: player.name, score: 1000, delta: 0 })) } })
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'hide-result'))
    expect(onAction).not.toHaveBeenCalled()
    tap(hud, hud.hitRegions.find(hit => hit.action.local === 'result'))
    tap(hud, hud.hitRegions.find(hit => hit.action.type === 'next'))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ type: 'next' })
  })
})

 describe('rotated device safe areas', () => {
  it('does not treat the portrait right edge as a landscape right inset', () => {
    const { hud } = makeHud()
    hud.resize({ windowWidth: 844, windowHeight: 390, screenWidth: 390, screenHeight: 844,
      safeArea: { left: 0, right: 390, top: 47, bottom: 810 },
      menuButton: { left: 290, right: 377, top: 50, bottom: 82 } })
    hud.update(turn)
    expect(hud.safe).toEqual({ left: 47, right: 47, top: 0, bottom: 0 })
    expect(hud.menuButton).toBeNull()
    const auto = hud.hitRegions.find(hit => hit.action.type === 'auto')
    expect(auto.x).toBeGreaterThan(700)
    expect(hud.handHits).toHaveLength(14)
    expect(hud.handHits.every(hit => hit.x >= 0 && hit.x + hit.w <= 844)).toBe(true)
  })
  it('preserves a valid landscape safe area', () => {
    const { hud } = makeHud()
    hud.resize({ windowWidth: 844, windowHeight: 390,
      safeArea: { left: 47, right: 797, top: 0, bottom: 369 } })
    expect(hud.safe).toEqual({ left: 47, right: 47, top: 0, bottom: 21 })
  })
})


it('opens the native login target directly from the mode chooser and creates the selected room length', () => {
  const { hud, onAction } = makeHud()
  hud.update({ phase: 'lobby', lobbyPage: 'modes' })
  expect(hud.hitRegions.some(hit => hit.action.type === 'start')).toBe(false)
  tap(hud, hud.hitRegions.find(hit => hit.action.type === 'login'))
  expect(onAction).toHaveBeenLastCalledWith({ type: 'login' })
  hud.update({ phase: 'lobby', lobbyPage: 'online', identity: { nickname: '小明', displayId: 'ABCD' } })
  tap(hud, hud.hitRegions.find(hit => hit.action.local === 'create-room'))
  tap(hud, hud.hitRegions.find(hit => hit.action.value === 'rounds16'))
  tap(hud, hud.hitRegions.find(hit => hit.action.type === 'create-room'))
  expect(onAction).toHaveBeenLastCalledWith({ type: 'create-room', matchType: 'rounds16' })
})

it.each([[667, 320], [844, 390], [1128, 532], [1024, 768]])('keeps seats and header controls outside the tile viewport at %s × %s', (width, height) => {
  const { hud } = makeHud()
  const menu = { left: width - 130, right: width - 12, top: 10, bottom: 42 }
  hud.resize({ windowWidth: width, windowHeight: height, safeArea: { left: 40, right: width - 40, top: 0, bottom: height - 20 }, menuButton: menu })
  const seats = vi.spyOn(hud, 'drawSeat')
  hud.ctx.fillText.mockClear()
  hud.update({ ...turn, matchType: 'rounds16', round: 9, online: { roomId: 'ABC234', status: 'connected' } })
  const b = hud.layout.board
  const intersects = (x, y, w, h) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y
  for (const [, , x, y, w, h] of seats.mock.calls) expect(intersects(x, y, w, h)).toBe(false)
  for (const hit of hud.hitRegions) {
    expect(intersects(hit.x, hit.y, hit.w, hit.h)).toBe(false)
    expect(hit.x < menu.right && hit.x + hit.w > menu.left && hit.y < menu.bottom && hit.y + hit.h > menu.top).toBe(false)
  }
  for (const player of players) expect(hud.ctx.fillText.mock.calls.filter(call => call[0] === player.name)).toHaveLength(1)
  expect(hud.ctx.fillText.mock.calls.some(call => /东风场|半庄场/.test(call[0]))).toBe(false)
})
