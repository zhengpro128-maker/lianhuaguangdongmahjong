// Exercise the real built runtime and native-button hit box with WeChat API stubs.
import { build } from 'vite'
import { chromium } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createPreviewServer } from './preview.mjs'

const built = await build({ configFile: 'miniprogram/vite.config.mjs', logLevel: 'error',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('https://mini.test') }, build: { write: false } })
const bundle = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk').code
const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
const browser = await chromium.launch({ ...(chrome && existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/js/game.bundle.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }))
  const shim = await readFile(new URL('../preview/wx-shim.js', import.meta.url), 'utf8')
  await page.route('**/preview/wx-shim.js', route => route.fulfill({ contentType: 'application/javascript', body: shim + `
    window.loginCalls = 0; window.createdModes = []; window.authDenied = true;
    wx.getMenuButtonBoundingClientRect = () => ({ left: innerWidth - 126, right: innerWidth - 12, top: 10, bottom: 42 });
    wx.getWindowInfo = () => ({ windowWidth: innerWidth, windowHeight: innerHeight, pixelRatio: devicePixelRatio,
      safeArea: { left: 44, right: innerWidth - 44, top: 0, bottom: innerHeight - 20 } });
    const capsule = document.createElement('div'); capsule.textContent = '•••  ◉';
    Object.assign(capsule.style, { position: 'fixed', right: '12px', top: '10px', width: '114px', height: '32px', background: '#000', color: '#fff', borderRadius: '20px', textAlign: 'center', lineHeight: '32px' });
    document.body.append(capsule);
    wx.createUserInfoButton = options => {
      const button = document.createElement('button'); button.id = 'native-login';
      Object.assign(button.style, { position: 'fixed', border: 'none', background: 'transparent' });
      const style = new Proxy({}, { set(target, key, value) { target[key] = value; button.style[key] = ['left','top','width','height','lineHeight'].includes(key) ? value + 'px' : value; return true; } });
      Object.assign(style, options.style); document.body.append(button);
      return { style, show: () => { button.style.display = 'block' }, hide: () => { button.style.display = 'none' }, destroy: () => button.remove(),
        onTap: callback => button.onclick = () => callback(window.authDenied ? { errMsg: 'cancel' } : { userInfo: { nickName: '微信测试玩家', avatarUrl: 'https://mini.test/avatar.png' } }) };
    };
    wx.showModal = options => { window.lastModal = options.title; options.success?.({ confirm: false }); };
    wx.login = ({ success }) => { window.loginCalls++; success({ code: 'test-code' }); };
    wx.request = request => {
      const path = new URL(request.url).pathname;
      const body = typeof request.data === 'string' ? JSON.parse(request.data) : request.data;
      let data;
      if (path.endsWith('/login')) data = { sessionToken: 'test-session', account: { id: 'test-player', displayName: '微信测试玩家', avatarUrl: 'https://mini.test/avatar.png' } };
      else if (path === '/api/rooms' && request.method === 'GET') data = { rooms: ['rounds4','rounds8','rounds16'].map((mode, i) => ({ roomId: ['DEF234','GHJ567','KLM789'][i], mode, rulesetId: 'wuhan-huanghuang', capacity: 4, occupied: i + 1 })) };
      else if (path.endsWith('/join')) data = { roomId: 'ABC234', seat: 0, nickname: '微信测试玩家', rejoinCode: 'test-rejoin', rejoin: false };
      else {
        if (request.method === 'POST' && path === '/api/rooms') window.createdModes.push(body.mode);
        data = { roomId: 'ABC234', mode: window.createdModes.at(-1), rulesetId: 'wuhan-huanghuang', capacity: 4, creatorSeat: 0, seats: [], status: 'lobby' };
      }
      request.success({ statusCode: 200, data });
    };
    wx.connectSocket = () => ({ onOpen: fn => setTimeout(fn, 1), onMessage: fn => setTimeout(() => fn({ data: JSON.stringify({ kind: 'rejoin_ok', roomId: 'ABC234', seat: 0, mode: window.createdModes.at(-1), nickname: '微信测试玩家', rejoinCode: 'test-rejoin', rejoin: false }) }), 5), onClose() {}, onError() {}, send() {}, close() {} });
  ` }))
  await page.route('https://mini.test/avatar.png', route => route.fulfill({ path: new URL('../assets/avatars/lotus.png', import.meta.url).pathname, headers: { 'access-control-allow-origin': '*' } }))
  await page.goto(`http://127.0.0.1:${server.address().port}/?test`)
  await page.waitForFunction(() => window.mini?.table.loaded)
  const tap = async filter => {
    await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([k, v]) => hit.action[k] === v)), filter)
    const box = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([k, v]) => hit.action[k] === v)), filter)
    await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2)
  }
  await page.locator('#native-login').click()
  assert.equal(await page.evaluate(() => window.loginCalls), 0)
  assert.equal(await page.evaluate(() => window.mini.snapshot().lobbyPage), 'modes')
  await page.evaluate(() => { window.authDenied = false })
  await page.locator('#native-login').click()
  await page.waitForFunction(() => window.mini.snapshot().lobbyPage === 'online')
  assert.equal(await page.evaluate(() => window.loginCalls), 1)
  assert.equal(await page.locator('#native-login').isVisible(), false)
  await mkdir('docs/evidence/miniprogram', { recursive: true })
  await page.waitForFunction(() => window.mini.hud.hitRegions.filter(hit => hit.action.type === 'join-listed-room').length === 3)
  await page.screenshot({ path: 'docs/evidence/miniprogram/mini-online.png' })
  await tap({ local: 'create-room' })
  await tap({ local: 'room-match', value: 'rounds16' })
  await page.screenshot({ path: 'docs/evidence/miniprogram/mini-create-room.png' })
  await tap({ type: 'create-room' })
  await page.waitForFunction(() => window.mini.snapshot().online?.roomId === 'ABC234')
  assert.deepEqual(await page.evaluate(() => window.createdModes), ['rounds16'])
  await page.evaluate(() => window.mini.dispatch({ type: 'leave-room' }))
  await tap({ type: 'lobby-page', value: 'modes' })
  await tap({ type: 'lobby-page', value: 'online' })
  assert.equal(await page.evaluate(() => window.loginCalls), 1)
  await tap({ type: 'lobby-page', value: 'modes' })
  await tap({ type: 'lobby-page', value: 'local' })
  await tap({ type: 'start' })
  await page.waitForFunction(() => window.mini.snapshot().isUserTurn)
  await page.waitForFunction(() => window.mini.hud.state.isUserTurn && window.mini.hud.handHits.length === 14 && [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  // A cross-origin avatar must not taint the preview HUD and freeze WebGL uploads.
  assert.equal(await page.evaluate(() => window.mini.hud.canvas.toDataURL().startsWith('data:image/png')), true)
  await page.screenshot({ path: 'docs/evidence/miniprogram/mini-table-safe-area.png' })
  await page.evaluate(() => window.mini.dispose())
  assert.deepEqual(errors, [])
  console.log('PASS: native mode-card authorization, cancellation/retry, automatic online lobby, 16-round room request, reuse login, safe areas and WeChat capsule.')
} finally { await browser.close(); server.close() }
