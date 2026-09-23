import { normalizeMiniMatch } from './match-options'
import { createWechatAuth } from './wechat-auth'
import { installWechatNetwork } from './online-client'
import { installMiniGamePlatform } from './platform.ts'
import { createMiniGame } from './game-bridge.ts'
import { ThreeTable } from './three-table.js'
import { MiniHud } from './hud.js'
import { createMiniAudio } from './audio.js'
import { getJoinableRooms } from '../../src/game/online/api/roomApi.ts'

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
  const sharedRoomId = options => {
    const value = options?.query?.room || options?.query?.roomId || ''
    const roomId = String(value).trim().toUpperCase()
    return /^[A-Z2-9]{6}$/.test(roomId) ? roomId : ''
  }
  let pendingInviteRoom = sharedRoomId(wxApi.getLaunchOptionsSync?.())
  let loginButton = null, onlineBusy = false, lobbyPage = 'modes'
  let loginStatus = pendingInviteRoom ? `好友邀请你加入房间 ${pendingInviteRoom}，请先微信登录` : ''
  let roomList = [], roomListLoading = false, roomListError = ''
  let saved = {}
  try { saved = wxApi.getStorageSync(SETTINGS_KEY) || {} } catch { /* storage unavailable */ }
  const settings = { ruleVariant: 'wuhan-huanghuang', matchType: normalizeMiniMatch(saved.matchType) }
  let soundEnabled = saved.soundEnabled !== false
  const audio = createMiniAudio(wxApi, soundEnabled)
  let system = windowInfo(wxApi)
  let game, hud, table
  let visible = true, disposed = false, dirty = true, overlayDirty = true
  let frame = null, touchStart = null, starting = false, lastFrame = 0, loadError = ''
  let roomPollTimer = null
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
      tableLayout: hud?.layout, lobbyPage, themeName: 'jade', soundEnabled, loading: starting, loadError,
      roomList, roomListLoading, roomListError, invitedRoomId: pendingInviteRoom }
  }
  function invalidate() { dirty = true }
  async function refreshRooms() {
    if (disposed || !visible || !auth.identity || lobbyPage !== 'online' || game.snapshot().phase !== 'lobby' || roomListLoading || game.snapshot().online?.roomId) return
    roomListLoading = true; roomListError = ''; invalidate()
    try {
      const result = await getJoinableRooms()
      roomList = (Array.isArray(result?.rooms) ? result.rooms : [])
        .filter(room => room?.rulesetId === 'wuhan-huanghuang')
        .slice(0, 4)
    } catch (error) {
      roomListError = error?.message || '房间列表加载失败'
    } finally {
      roomListLoading = false; invalidate()
    }
  }
  function sharePayload() {
    const roomId = game.snapshot().online?.roomId
    return roomId ? { title: `武汉晃晃 · 房间 ${roomId}，点击直接加入`, query: `room=${encodeURIComponent(roomId)}` }
      : { title: '武汉晃晃 · 四人同桌', query: '' }
  }
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
      syncLoginButton()
      if (overlayDirty) { table.markOverlayDirty(); overlayDirty = false }
      table.render(time); lastFrame = time
    }
    frame = requestFrame(draw)
  }
  function syncLoginButton() {
    const hit = hud.hits.find(item => item.action.type === 'login')
    const show = visible && !disposed && !onlineBusy && !auth.identity && !hud.modal && hit
    if (!show) { loginButton?.hide(); return }
    if (!wxApi.createUserInfoButton) return
    if (!loginButton) {
      loginButton = wxApi.createUserInfoButton({ type: 'text', text: '',
        style: { left: hit.x, top: hit.y, width: hit.w, height: hit.h, lineHeight: hit.h,
          backgroundColor: 'rgba(0,0,0,0)', color: 'rgba(0,0,0,0)', textAlign: 'center', fontSize: 12, borderRadius: 6 } })
      loginButton.onTap(async result => {
        if (onlineBusy || disposed) return
        if (!result.userInfo) {
          loginStatus = '未获得头像昵称授权，登录未完成'
          wxApi.showModal?.({ title: '登录未完成', content: result.errMsg || loginStatus, showCancel: false })
          invalidate(); return
        }
        await performOnline({ type: 'login', profile: result.userInfo })
      })
    }
    if (loginButton.style) Object.assign(loginButton.style, { left: hit.x, top: hit.y, width: hit.w, height: hit.h, lineHeight: hit.h })
    loginButton.show()
  }
  async function onlineAction(action) {
    if (onlineBusy) return
    if (action.type === 'login') {
      // The native button already exists before the user's first touch.
      // Canvas events must not recreate it or destroy its pending callback.
      if (!wxApi.createUserInfoButton) wxApi.showModal?.({ title: '无法授权', content: '当前环境不支持微信原生头像昵称授权，请使用手机微信体验版。', showCancel: false })
      return
    }
    await performOnline(action)
  }
  async function performOnline(action) {
    onlineBusy = true
    if (action.type !== 'leave-room') loginStatus = '正在登录 / 连接服务器…'
    invalidate()
    loginButton?.hide()
    wxApi.showLoading?.({ title: action.type === 'leave-room' ? '正在退出…' : '正在连接…', mask: true })
    try {
      if (action.type === 'login') {
        const user = await auth.authorize(action.profile)
        game.setProfile(user)
        lobbyPage = 'online'
        loginStatus = `已登录：${user.nickname} · 编号 ${user.displayId}`
        const invitedRoom = pendingInviteRoom
        if (invitedRoom) {
          pendingInviteRoom = ''
          await game.enterOnline(auth.identity, invitedRoom)
          wxApi.showToast?.({ title: `已加入房间 ${invitedRoom}`, icon: 'success' })
        } else {
          await refreshRooms()
        }
      }
      else {
        if (action.type === 'leave-room') {
          // A saved room can be released before the player logs in again. The
          // room seat is authenticated by its persisted rejoin code.
          await game.leaveOnline()
          loginStatus = auth.identity ? `已登录：${auth.identity.nickname} · 编号 ${auth.identity.displayId}` : ''
          if (auth.identity) await refreshRooms()
          wxApi.showToast?.({ title: '已退出联机房间', icon: 'success' })
        } else {
          if (!auth.identity) throw new Error('请先点击联机模式，完成微信登录后再进入房间')
          if (action.type === 'create-room') await game.enterOnline(auth.identity, undefined, normalizeMiniMatch(action.matchType || settings.matchType))
          if (action.type === 'join-listed-room') {
            await game.enterOnline(auth.identity, action.roomId)
            if (pendingInviteRoom === action.roomId) pendingInviteRoom = ''
          }
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
        }
      }
    } catch (error) { loginStatus = error?.message || error?.errMsg || '连接失败，请重试'; wxApi.hideLoading?.(); wxApi.showModal?.({ title: '联机提示', content: error?.message || error?.errMsg || '网络连接失败，请重试', showCancel: false }) }
    finally { wxApi.hideLoading?.(); onlineBusy = false; invalidate() }
  }
  async function act(action) {
    if (disposed) return
    if (['login', 'create-room', 'join-room', 'join-listed-room', 'ready-room', 'start-room', 'leave-room', 'resume-room'].includes(action.type)) return onlineAction(action)
    switch (action.type) {
      case 'lobby-page':
        if (action.value === 'online' && !auth.identity) return onlineAction({ type: 'login' })
        lobbyPage = ['local', 'online'].includes(action.value) ? action.value : 'modes'
        if (lobbyPage === 'online') await refreshRooms()
        break
      case 'refresh-rooms': await refreshRooms(); break
      case 'share-room':
        if (wxApi.shareAppMessage) wxApi.shareAppMessage(sharePayload())
        else wxApi.showModal?.({ title: '分享房间', content: '请点击右上角菜单，将当前房间分享给微信好友。', showCancel: false })
        break
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
      case 'match': settings.matchType = normalizeMiniMatch(action.value); saveSettings(); break
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
  const onShow = options => {
    if (disposed) return
    visible = true; lastFrame = 0
    audio.setHidden(false); game.resume?.(); onResize()
    const invitedRoom = sharedRoomId(options)
    if (invitedRoom) {
      pendingInviteRoom = invitedRoom
      if (auth.identity && !game.snapshot().online?.roomId) void performOnline({ type: 'join-listed-room', roomId: invitedRoom })
      else if (!auth.identity) loginStatus = `好友邀请你加入房间 ${invitedRoom}，请先微信登录`
    } else void refreshRooms()
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
  wxApi.showShareMenu?.({ menus: ['shareAppMessage'] })
  const onShareAppMessage = () => sharePayload()
  wxApi.onShareAppMessage?.(onShareAppMessage)
  wxApi.setKeepScreenOn?.({ keepScreenOn: true })
  roomPollTimer = setInterval(() => void refreshRooms(), 5000)
  frame = requestFrame(draw)
  return { canvas, game, hud, table, snapshot, dispatch: act,
    dispose() {
      if (disposed) return
      disposed = true
      loginButton?.destroy(); loginButton = null
      if (roomPollTimer !== null) clearInterval(roomPollTimer)
      if (frame !== null) cancelFrame(frame)
      wxApi.offHide?.(onHide); wxApi.offShow?.(onShow); wxApi.offWindowResize?.(onResize)
      wxApi.offShareAppMessage?.(onShareAppMessage)
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
