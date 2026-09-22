import { installMiniGamePlatform } from './platform.ts'
import { createMiniGame } from './game-bridge.ts'
import { ThreeTable } from './three-table.js'
import { MiniHud } from './hud.js'
import { createMiniAudio } from './audio.js'

const SETTINGS_KEY = 'wuhan-mini.settings.v1'
export function windowInfo(wxApi) {
  const info = wxApi.getWindowInfo?.() ?? wxApi.getSystemInfoSync()
  let menuButton = null
  try { menuButton = wxApi.getMenuButtonBoundingClientRect?.() ?? null } catch { /* unsupported host */ }
  return { ...info, windowWidth: info.windowWidth || info.screenWidth,
    windowHeight: info.windowHeight || info.screenHeight, menuButton }
}

/** One screen canvas, shared web rules, and a native Canvas HUD. No WebView. */
export function bootMiniGame(wxApi = globalThis.wx) {
  // The FIRST wx canvas is the screen. Create it before any texture factory.
  const canvas = wxApi.createCanvas()
  installMiniGamePlatform(wxApi)
  let saved = {}
  try { saved = wxApi.getStorageSync(SETTINGS_KEY) || {} } catch { /* storage unavailable */ }
  const settings = { ruleVariant: 'wuhan-huanghuang', matchType: saved.matchType === 'hanchan' ? 'hanchan' : 'east' }
  let soundEnabled = saved.soundEnabled !== false
  const audio = createMiniAudio(wxApi, soundEnabled)
  let system = windowInfo(wxApi)
  let game, hud, table
  let visible = true, disposed = false, dirty = true, overlayDirty = true
  let frame = null, touchStart = null, starting = false, lastFrame = 0, loadError = ''
  const requestFrame = canvas.requestAnimationFrame?.bind(canvas)
    ?? globalThis.requestAnimationFrame?.bind(globalThis)
    ?? (callback => setTimeout(() => callback(Date.now()), 33))
  const cancelFrame = canvas.cancelAnimationFrame?.bind(canvas)
    ?? globalThis.cancelAnimationFrame?.bind(globalThis) ?? clearTimeout

  function saveSettings() {
    try { wxApi.setStorageSync(SETTINGS_KEY, { matchType: settings.matchType, soundEnabled }) } catch { /* retain in memory */ }
  }
  function snapshot() {
    const state = game.snapshot()
    return { ...state, screen: state.phase === 'lobby' ? 'lobby' : 'game',
      settings, selectedRule: 'wuhan-huanghuang', selectedMatch: settings.matchType,
      themeName: 'jade', soundEnabled, loading: starting, loadError }
  }
  function invalidate() { dirty = true }
  function draw(time = 0) {
    frame = null
    if (disposed || !visible) return
    // Cap rendering at 30fps instead of burning battery on 120Hz displays.
    if (!lastFrame || time - lastFrame >= 30 || dirty || overlayDirty) {
      if (dirty) {
        const state = snapshot()
        table.update(state); hud.update(state)
        overlayDirty = true; dirty = false
      }
      if (overlayDirty) { table.markOverlayDirty(); overlayDirty = false }
      table.render(time); lastFrame = time
    }
    frame = requestFrame(draw)
  }
  async function act(action) {
    if (disposed) return
    switch (action.type) {
      case 'start':
        if (starting) return
        starting = true; invalidate()
        try {
          await table.ready
          if (!disposed) {
            loadError = ''
            await game.start({ ...settings, gameMode: 'local' })
          }
        } catch (error) {
          if (!disposed) {
            loadError = '牌桌加载失败，请重新进入小游戏'
            wxApi.showModal?.({ title: '牌桌加载失败', content: String(error?.message || error), showCancel: false })
          }
        } finally { starting = false; invalidate() }
        break
      case 'match': settings.matchType = action.value === 'hanchan' ? 'hanchan' : 'east'; saveSettings(); break
      case 'sound': soundEnabled = !soundEnabled; audio.setEnabled(soundEnabled); saveSettings(); break
      case 'select': game.selectTile(action.index); break
      case 'discard': game.discard(action.index); break
      case 'action': game.action(action.id, action); break
      case 'next': game.nextRound(); break
      case 'lobby': game.backToLobby(); break
      case 'auto': game.setAutoPlay?.(!game.snapshot().autoPlay); break
      case 'clear-selection': game.clearSelection?.(); break
      case 'hint': game.hint?.(); break
    }
    invalidate()
  }
  game = createMiniGame({ onChange: invalidate, playSound: audio.playSound,
    playSoundAndWait: audio.playSoundAndWait, getThemeName: () => 'jade', countdownEnabled: false })
  hud = new MiniHud({ createCanvas: () => wxApi.createCanvas(), createImage: () => wxApi.createImage(),
    onAction: act, onInvalidate: () => { overlayDirty = true } })
  hud.resize(system)
  try {
    table = new ThreeTable(canvas, system, { invalidate,
      onError: error => { loadError = String(error?.message || error); invalidate() } })
  } catch (error) {
    game.dispose(); hud.dispose?.(); audio.dispose()
    throw error
  }
  table.setOverlay(hud.canvas)
  table.ready?.catch(error => { if (!disposed) { loadError = String(error?.message || error); invalidate() } })

  const point = event => {
    const touch = event.changedTouches?.[0] ?? event.touches?.[0]
    return touch && { x: touch.clientX ?? touch.pageX ?? touch.x,
      y: touch.clientY ?? touch.pageY ?? touch.y, id: touch.identifier }
  }
  const onTouchStart = event => {
    if (visible && !disposed && !touchStart) touchStart = point(event)
  }
  const onTouchCancel = () => { touchStart = null }
  const onTouchEnd = event => {
    const start = touchStart
    if (!start || !visible || disposed) return
    const ended = Array.from(event.changedTouches || []).find(touch => start.id === undefined || touch.identifier === start.id)
    if (!ended) return
    const end = point({ changedTouches: [ended] })
    touchStart = null
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    if (distance > 14) hud.handleSwipe?.(start.x, start.y, end.x, end.y)
    else hud.handleTouch(end.x, end.y)
    overlayDirty = true
  }
  const onHide = () => {
    visible = false; touchStart = null
    if (frame !== null) { cancelFrame(frame); frame = null }
    audio.setHidden(true); game.pause?.()
  }
  const onResize = event => {
    system = { ...windowInfo(wxApi), ...event?.size }
    hud.resize(system); table.resize(system)
    overlayDirty = true; invalidate()
  }
  const onShow = () => {
    if (disposed) return
    visible = true; lastFrame = 0
    audio.setHidden(false); game.resume?.(); onResize()
    if (frame === null) frame = requestFrame(draw)
  }
  // Real Mini Games use wx events. DOM events are only a preview fallback.
  const useWxTouches = typeof wxApi.onTouchEnd === 'function'
  if (useWxTouches) {
    wxApi.onTouchStart(onTouchStart); wxApi.onTouchEnd(onTouchEnd); wxApi.onTouchCancel?.(onTouchCancel)
  } else {
    canvas.addEventListener('touchstart', onTouchStart)
    canvas.addEventListener('touchend', onTouchEnd)
    canvas.addEventListener('touchcancel', onTouchCancel)
  }
  wxApi.onHide?.(onHide); wxApi.onShow?.(onShow); wxApi.onWindowResize?.(onResize)
  wxApi.setKeepScreenOn?.({ keepScreenOn: true })
  frame = requestFrame(draw)
  return { canvas, game, hud, table, snapshot, dispatch: act,
    dispose() {
      if (disposed) return
      disposed = true
      if (frame !== null) cancelFrame(frame)
      wxApi.offHide?.(onHide); wxApi.offShow?.(onShow); wxApi.offWindowResize?.(onResize)
      if (useWxTouches) {
        wxApi.offTouchStart?.(onTouchStart); wxApi.offTouchEnd?.(onTouchEnd); wxApi.offTouchCancel?.(onTouchCancel)
      } else {
        canvas.removeEventListener('touchstart', onTouchStart); canvas.removeEventListener('touchend', onTouchEnd)
        canvas.removeEventListener('touchcancel', onTouchCancel)
      }
      game.dispose(); hud.dispose?.(); table.dispose(); audio.dispose()
      wxApi.setKeepScreenOn?.({ keepScreenOn: false })
    },
  }
}
