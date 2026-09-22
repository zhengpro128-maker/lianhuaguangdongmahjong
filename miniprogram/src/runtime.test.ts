import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootMiniGame } from './runtime.js'

const capture = vi.hoisted(() => ({ ready: null as Promise<void> | null, game: null as any,
  hud: null as any, table: null as any, audio: null as any, order: [] as string[] }))
vi.mock('./game-bridge.ts', () => ({ createMiniGame: (options: any) => {
  capture.order.push('game')
  const state = { phase: 'lobby', autoPlay: false }
  capture.game = { snapshot: vi.fn(() => ({ ...state })), start: vi.fn(async () => { state.phase = 'dealing'; options.onChange() }),
    selectTile: vi.fn(), discard: vi.fn(), action: vi.fn(), nextRound: vi.fn(),
    backToLobby: vi.fn(() => { state.phase = 'lobby'; options.onChange() }),
    setAutoPlay: vi.fn((value: boolean) => { state.autoPlay = value }), pause: vi.fn(), resume: vi.fn(),
    clearSelection: vi.fn(), hint: vi.fn(), dispose: vi.fn() }
  return capture.game
} }))
vi.mock('./three-table.js', () => ({ ThreeTable: class {
  ready = capture.ready ?? Promise.resolve()
  update = vi.fn(); render = vi.fn(); markOverlayDirty = vi.fn(); resize = vi.fn(); setOverlay = vi.fn(); dispose = vi.fn()
  constructor(public canvas: any) { capture.order.push('table'); capture.table = this }
} }))
vi.mock('./hud.js', () => ({ MiniHud: class {
  canvas: any
  update = vi.fn(); resize = vi.fn(); handleTouch = vi.fn(); handleSwipe = vi.fn(); dispose = vi.fn()
  constructor(options: any) { capture.order.push('hud'); this.canvas = options.createCanvas(); capture.hud = this }
} }))
vi.mock('./audio.js', () => ({ createMiniAudio: () => {
  capture.audio = { playSound: vi.fn(), playSoundAndWait: vi.fn(async () => {}),
    setEnabled: vi.fn(), setHidden: vi.fn(), dispose: vi.fn() }
  return capture.audio
} }))

let app: ReturnType<typeof bootMiniGame> | null
let wxApi: any
let callbacks: Record<string, (...args: any[]) => void>
let frames: Map<number, (time: number) => void>
beforeEach(() => {
  vi.stubGlobal('window', undefined); vi.stubGlobal('localStorage', undefined)
  capture.ready = null; capture.order = []; callbacks = {}; frames = new Map()
  let frameId = 0
  wxApi = { getWindowInfo: () => ({ windowWidth: 844, windowHeight: 390, pixelRatio: 2 }),
    getStorageSync: vi.fn(), setStorageSync: vi.fn(), createImage: vi.fn(), showModal: vi.fn(), setKeepScreenOn: vi.fn(),
    createCanvas: vi.fn(() => {
      capture.order.push('canvas')
      return { requestAnimationFrame: vi.fn(callback => { frames.set(++frameId, callback); return frameId }),
        cancelAnimationFrame: vi.fn(id => frames.delete(id)) }
    }) }
  for (const event of ['TouchStart', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize']) {
    wxApi[`on${event}`] = vi.fn(callback => { callbacks[event] = callback })
    wxApi[`off${event}`] = vi.fn()
  }
})
afterEach(() => { app?.dispose(); app = null; vi.unstubAllGlobals(); vi.restoreAllMocks() })
function touch(identifier: number, x: number, y: number) { return { identifier, clientX: x, clientY: y } }
function event(...touches: ReturnType<typeof touch>[]) { return { changedTouches: touches, touches } }
function paint(time = 100) {
  const [id, callback] = frames.entries().next().value!
  frames.delete(id); callback(time)
}

describe('WeChat runtime lifecycle and gestures', () => {
  it('claims the screen before offscreen canvases and drives the shared overlay', () => {
    app = bootMiniGame(wxApi)
    expect(capture.order).toEqual(['canvas', 'game', 'hud', 'canvas', 'table'])
    expect(capture.table.canvas).toBe(app.canvas)
    expect(capture.table.setOverlay).toHaveBeenCalledWith(capture.hud.canvas)
    paint()
    expect(capture.table.update).toHaveBeenCalledWith(expect.objectContaining({ screen: 'lobby', themeName: 'jade' }))
    expect(capture.hud.update).toHaveBeenCalledTimes(1)
    expect(capture.table.render).toHaveBeenCalledTimes(1)
  })

  it('routes complete taps and upward drags to the HUD', () => {
    app = bootMiniGame(wxApi)
    callbacks.TouchStart(event(touch(1, 100, 300)))
    callbacks.TouchEnd(event(touch(1, 101, 298)))
    expect(capture.hud.handleTouch).toHaveBeenCalledWith(101, 298)
    callbacks.TouchStart(event(touch(1, 110, 300)))
    callbacks.TouchEnd(event(touch(1, 110, 230)))
    expect(capture.hud.handleSwipe).toHaveBeenCalledWith(110, 300, 110, 230)
  })

  it('never turns a canceled gesture into a tap', () => {
    app = bootMiniGame(wxApi)
    callbacks.TouchStart(event(touch(1, 100, 300)))
    callbacks.TouchCancel(event(touch(1, 100, 300)))
    callbacks.TouchEnd(event(touch(1, 100, 300)))
    expect(capture.hud.handleTouch).not.toHaveBeenCalled()
    expect(capture.hud.handleSwipe).not.toHaveBeenCalled()
  })

  it('keeps the original primary touch when a second finger lands and lifts', () => {
    app = bootMiniGame(wxApi)
    callbacks.TouchStart(event(touch(1, 100, 300)))
    callbacks.TouchStart(event(touch(2, 240, 90)))
    callbacks.TouchEnd(event(touch(2, 240, 90)))
    expect(capture.hud.handleTouch).not.toHaveBeenCalled()
    callbacks.TouchEnd(event(touch(1, 100, 300)))
    expect(capture.hud.handleTouch).toHaveBeenCalledExactlyOnceWith(100, 300)
  })

  it('pauses rendering, audio and human automation while hidden and drops gestures crossing visibility changes', () => {
    app = bootMiniGame(wxApi)
    callbacks.TouchStart(event(touch(1, 100, 300)))
    callbacks.Hide()
    expect(frames.size).toBe(0)
    expect(capture.game.pause).toHaveBeenCalledOnce()
    expect(capture.audio.setHidden).toHaveBeenLastCalledWith(true)
    callbacks.Show()
    expect(frames.size).toBe(1)
    expect(capture.game.resume).toHaveBeenCalledOnce()
    expect(capture.audio.setHidden).toHaveBeenLastCalledWith(false)
    callbacks.TouchEnd(event(touch(1, 100, 300)))
    expect(capture.hud.handleTouch).not.toHaveBeenCalled()
  })

  it('deduplicates a start while assets load and ignores the pending start after disposal', async () => {
    let resolve!: () => void
    capture.ready = new Promise<void>(done => { resolve = done })
    app = bootMiniGame(wxApi)
    const first = app.dispatch({ type: 'start' })
    await app.dispatch({ type: 'start' })
    expect(capture.game.start).not.toHaveBeenCalled()
    app.dispose()
    resolve(); await first
    expect(capture.game.start).not.toHaveBeenCalled()
    expect(capture.game.dispose).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('does not display an obsolete resource-error modal after disposal', async () => {
    let reject!: (error: Error) => void
    capture.ready = new Promise<void>((_, fail) => { reject = fail })
    app = bootMiniGame(wxApi)
    const pending = app.dispatch({ type: 'start' })
    app.dispose()
    reject(new Error('texture load failed'))
    await pending
    expect(wxApi.showModal).not.toHaveBeenCalled()
  })

  it('unregisters the exact host event handlers and disposes resources once', () => {
    app = bootMiniGame(wxApi)
    app.dispose(); app.dispose()
    for (const event of ['TouchStart', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize']) {
      expect(wxApi[`off${event}`]).toHaveBeenCalledExactlyOnceWith(callbacks[event])
    }
    expect(capture.game.dispose).toHaveBeenCalledOnce()
    expect(capture.hud.dispose).toHaveBeenCalledOnce()
    expect(capture.table.dispose).toHaveBeenCalledOnce()
    expect(capture.audio.dispose).toHaveBeenCalledOnce()
    expect(wxApi.setKeepScreenOn).toHaveBeenLastCalledWith({ keepScreenOn: false })
  })
})
