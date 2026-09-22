import { createWechatAuth } from './wechat-auth'
import { installWechatNetwork } from './online-client'
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
  const auth = createWechatAuth(wxApi)
  installWechatNetwork(wxApi, () => auth.identity?.sessionToken || '')
  let loginButton = null, onlineBusy = false, loginStatus = ''
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
      identity: auth.identity ? { nickname: auth.identity.nickname, avatarUrl: auth.identity.avatarUrl, displayId: auth.identity.displayId } : null, onlineBusy, loginStatus, settings, selectedRule: 'wuhan-huanghuang', selectedMatch: settings.matchType,
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
  async function onlineAction(action) {
    if (onlineBusy) return
    if (action.type !== 'profile') { loginButton?.destroy(); loginButton = null }
    if (action.type === 'profile' && wxApi.createUserInfoButton) {
      if (loginButton) return
      const hit = hud.hits.find(item => item.action.type === 'profile')
      if (!hit) return
      loginButton = wxApi.createUserInfoButton({ type: 'text', text: '点击授权头像昵称',
        style: { left: hit.x, top: hit.y, width: hit.w, height: hit.h, lineHeight: hit.h,
          backgroundColor: '#b99249', color: '#102418', textAlign: 'center', fontSize: 12, borderRadius: 6 } })
      wxApi.showToast?.({ title: '请再点击授权按钮', icon: 'none' })
      loginButton.onTap(async result => {
        loginButton?.destroy(); loginButton = null
        if (!result.userInfo) {
          wxApi.showModal?.({ title: '未获得头像昵称', content: '未授权玩家资料。可再次点击微信登录授权；创建房间时仍可使用默认资料登录。', showCancel: false })
          return
        }
        await performOnline({ type: 'login', profile: result.userInfo })
      })
      return
    }
    if (action.type === 'profile') {
      wxApi.showModal?.({ title: '资料授权不可用', content: '当前微信环境未提供头像昵称授权按钮，身份登录仍可正常使用。', showCancel: false })
      return
    }
    await performOnline(action)
  }
  async function performOnline(action) {
    onlineBusy = true; loginStatus = '正在登录 / 连接服务器…'; invalidate()
    wxApi.showLoading?.({ title: '正在连接…', mask: true })
    try {
      if (action.type === 'login') {
        const user = await auth.authorize(action.profile)
        game.setProfile(user)
        loginStatus = `已登录：${user.nickname} · 编号 ${user.displayId}`
        wxApi.hideLoading?.()
        wxApi.showModal?.({ title: '微信登录成功', content: `玩家编号：${user.displayId}\n昵称：${user.nickname}\n${user.avatarUrl ? '已获取头像' : '身份登录已完成。点击大厅的头像昵称按钮可单独申请资料授权。'}`, showCancel: false })
      }
      else {
        if (!auth.identity) game.setProfile(await auth.authorize())
        if (action.type === 'create-room') await game.enterOnline(auth.identity, undefined, settings.matchType)
        if (action.type === 'join-room') {
          const result = await new Promise(resolve => wxApi.showModal({ title: '加入房间', editable: true,
            placeholderText: '输入 6 位房间号', success: resolve, fail: () => resolve({ confirm: false }) }))
          if (result.confirm) {
            const code = (result.content || '').trim().toUpperCase()
            if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('请输入正确的 6 位房间号')
            await game.enterOnline(auth.identity, code)
          }
        }
        if (action.type === 'resume-room') await game.resumeOnline(auth.identity)
        if (action.type === 'ready-room') await game.readyOnline()
        if (action.type === 'start-room') await game.startOnline()
        if (action.type === 'leave-room') await game.leaveOnline()
      }
    } catch (error) { loginStatus = error?.message || error?.errMsg || '连接失败，请重试'; wxApi.hideLoading?.(); wxApi.showModal?.({ title: '联机提示', content: error?.message || error?.errMsg || '网络连接失败，请重试', showCancel: false }) }
    finally { wxApi.hideLoading?.(); onlineBusy = false; invalidate() }
  }
  async function act(action) {
    if (disposed) return
    if (['login', 'profile', 'create-room', 'join-room', 'ready-room', 'start-room', 'leave-room', 'resume-room'].includes(action.type)) return onlineAction(action)
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
      case 'lobby': if (game.snapshot().online) await game.leaveOnline(); else game.backToLobby(); break
      case 'auto': game.setAutoPlay?.(!game.snapshot().autoPlay); break
      case 'clear-selection': game.clearSelection?.(); break
      case 'hint': game.hint?.(); break
    }
    invalidate()
  }
  game = createMiniGame({ onChange: invalidate, playSound: audio.playSound,
    playSoundAndWait: audio.playSoundAndWait, getThemeName: () => 'jade', waitForTableReady: () => table.ready, countdownEnabled: false })
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
    loginButton?.hide()
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
    loginButton?.show()
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
      loginButton?.destroy(); loginButton = null
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
