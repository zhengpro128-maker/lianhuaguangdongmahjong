// Four real Mini Game runtimes, backed by a shared in-memory room transport.
// Only native wx network/auth/audio APIs are substituted; room messages enter
// through WebSocket.onMessage and all sending uses production HUD touch actions.
import { build } from 'vite'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPreviewServer } from './preview.mjs'

const roomId = 'ABC234', output = path.resolve('docs/evidence/miniprogram-social-online')
const clients = [], connected = new Set(), sent = [], requests = [], broadcasts = []
const report = { interactions: [], messages: [], disconnected: null, left: null }
const hand = ['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'm6', 'm7', 'p8', 'p9']
const info = () => ({ roomId, mode: 'rounds4', rulesetId: 'wuhan-huanghuang', capacity: 4, creatorSeat: 0, status: 'playing',
  seats: Array.from({ length: 4 }, (_, seat) => ({ seat, nickname: `联机玩家${seat}`, ready: true, connected: connected.has(seat) })) })
const snapshot = viewer => ({ kind: 'state_snapshot', roomId, mode: 'rounds4', rulesetId: 'wuhan-huanghuang', phase: 'drawing',
  round: 1, dealer: 0, honba: 0, wallCount: 80, wall: [], headDrawn: 0, currentPlayer: 0, seat: viewer,
  flipTile: 'm9', jokerTiles: ['m1'], wildcardTiles: ['m1'], flipStack: null, openingStack: null,
  result: null, announcement: null, matchFinished: false, lastDiscard: null, winPresentation: null, winningPlayerIndex: -1,
  players: Array.from({ length: 4 }, (_, seat) => ({ seat, name: `联机玩家${seat}`, avatar: '', score: 1000,
    hand: seat === viewer ? [...hand] : hand.map(() => null), discards: [], melds: [], redCount: 0, drawnTileIndex: -1 })) })

const built = await build({ configFile: 'miniprogram/vite.config.mjs', logLevel: 'error',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('https://mini.test') }, build: { write: false } })
const bundle = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk').code
const shim = await readFile(new URL('../preview/wx-shim.js', import.meta.url), 'utf8')
const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
const browser = await chromium.launch({ ...(chrome && existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
await mkdir(output, { recursive: true })

async function deliver(seat, event) {
  return clients[seat].page.evaluate(message => window.__socialDeliver(message), event)
}
async function broadcast(event) {
  broadcasts.push(event)
  await Promise.all([...connected].map(seat => deliver(seat, event)))
}
async function tap(page, filter) {
  await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
  const hit = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
  await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
}
async function tapProp(page, value) {
  const hit = await page.evaluate(value => window.mini.hud.hitRegions.find(hit => hit.action.payload?.value === value), value)
  assert.ok(hit, `The ${value} action is enabled`)
  await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
}
async function eventsAfter(id) {
  return Promise.all(clients.map(async ({ page, seat }) => {
    await page.waitForFunction(id => window.mini.hud.state.socialEvents.some(event => event.id === id), id)
    const state = await page.evaluate(id => ({ mode: window.mini.snapshot().gameMode, localSeat: window.mini.snapshot().user.seat,
      absoluteSeat: window.mini.snapshot().online.mySeat, animating: window.mini.hud.socialAnimating,
      event: window.mini.hud.state.socialEvents.find(event => event.id === id) }), id)
    assert.equal(state.mode, 'online'); assert.equal(state.localSeat, 0); assert.equal(state.absoluteSeat, seat)
    assert.equal(state.animating, true)
    return state
  }))
}
function checkRotations(event, states) {
  for (const [viewer, state] of states.entries()) {
    assert.equal(state.event.seat, (event.seat - viewer + 4) % 4, `Sender is rotated for viewer ${viewer}`)
    if (event.category === 'prop') assert.equal(state.event.targetSeat, (event.targetSeat - viewer + 4) % 4, `Target is rotated for viewer ${viewer}`)
    assert.equal(state.event.category, event.category); assert.equal(state.event.value, event.value)
  }
}

try {
  for (let seat = 0; seat < 4; seat++) {
    const page = await browser.newPage({ viewport: seat < 2 ? { width: 844, height: 390 } : { width: 667, height: 320 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    const errors = [], client = { page, seat, errors }; clients.push(client)
    page.on('pageerror', error => errors.push(error.message))
    await page.exposeBinding('__socialRoomBus', async (_source, packet) => {
      if (packet.op === 'request') {
        const requestPath = new URL(packet.url).pathname, body = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data
        requests.push({ seat, path: requestPath, method: packet.method, authorization: packet.header?.Authorization })
        if (requestPath.endsWith('/login')) return { sessionToken: `session-${seat}`, account: { id: `account-${seat}`, displayName: `联机玩家${seat}`, avatarUrl: `https://mini.test/avatar-${seat}.png` } }
        assert.equal(packet.header?.Authorization, `Bearer session-${seat}`, `Native authenticated request for seat ${seat}`)
        if (requestPath === '/api/rooms') return { rooms: [{ roomId, mode: 'rounds4', rulesetId: 'wuhan-huanghuang', capacity: 4, occupied: 3, status: 'lobby' }] }
        if (requestPath.endsWith('/join')) return { roomId, seat, nickname: `联机玩家${seat}`, playerId: `account-${seat}`, rejoinCode: `rejoin-${seat}`, rejoin: false }
        if (requestPath.endsWith('/leave')) {
          assert.equal(body.seat, seat); connected.delete(seat)
          return { roomId, seat, left: true }
        }
        if (requestPath === `/api/rooms/${roomId}`) return info()
        throw new Error(`Unexpected request: ${requestPath}`)
      }
      if (packet.op === 'connect') {
        connected.add(seat)
        return [{ kind: 'rejoin_ok', roomId, seat, mode: 'rounds4', rulesetId: 'wuhan-huanghuang', nickname: `联机玩家${seat}`, rejoinCode: `rejoin-${seat}`, rejoin: false }, snapshot(seat)]
      }
      if (packet.op === 'close') { connected.delete(seat); return true }
      if (packet.op === 'send') {
        const message = JSON.parse(packet.data); sent.push({ seat, ...message })
        if (message.type === 'ping') return deliver(seat, { kind: 'pong', t: message.t })
        if (message.type !== 'room_social') return true
        assert.ok(connected.has(seat), 'A disconnected client cannot reach the room bus')
        const { type: _type, ...payload } = message
        const event = { ...payload, kind: 'room_social', id: `room-social-${broadcasts.length + 1}`, seat }
        await broadcast(event)
        return true
      }
      throw new Error(`Unexpected bus operation: ${packet.op}`)
    })
    await page.route('**/js/game.bundle.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }))
    await page.route('https://mini.test/avatar-*.png', route => route.fulfill({ path: new URL(`../assets/avatars/${['lotus', 'ah-lok', 'shisan', 'young-master'][seat]}.png`, import.meta.url).pathname, headers: { 'access-control-allow-origin': '*' } }))
    await page.route('**/preview/wx-shim.js', route => route.fulfill({ contentType: 'application/javascript', body: shim + `
      window.__socialSounds = []; window.__socialHaptics = []; window.__socialToasts = []; window.__socialSockets = [];
      wx.createUserInfoButton = options => {
        const button = document.createElement('button'); button.id = 'native-login';
        Object.assign(button.style, { position:'fixed', border:'none', background:'transparent' });
        const style = new Proxy({}, { set(target,key,value) { target[key]=value; button.style[key]=['left','top','width','height','lineHeight'].includes(key) ? value+'px' : value; return true; } });
        Object.assign(style,options.style); document.body.append(button);
        return { style, show:()=>button.style.display='block', hide:()=>button.style.display='none', destroy:()=>button.remove(),
          onTap:fn=>button.onclick=()=>fn({ userInfo:{ nickName:'联机玩家${seat}', avatarUrl:'https://mini.test/avatar-${seat}.png' } }) };
      };
      wx.login = options => options.success({ code:'code-${seat}' });
      wx.request = options => window.__socialRoomBus({ op:'request', url:options.url, method:options.method||'GET', data:options.data, header:options.header }).then(data=>options.success({ statusCode:200, data }),error=>options.fail?.({ errMsg:error.message }));
      wx.showToast = options => window.__socialToasts.push(options.title);
      wx.vibrateShort = options => { window.__socialHaptics.push({ type:options.type, at:Date.now() }); options.success?.({}); };
      wx.createInnerAudioContext = () => {
        const audio = { source:'', volume:0, set src(value) { this.source=value }, onEnded(fn) { this.ended=fn }, onError() {}, onStop() {},
          play() { window.__socialSounds.push({ source:this.source, at:Date.now() }); Promise.resolve().then(()=>this.ended?.()) }, destroy() {} };
        return audio;
      };
      window.__socialDeliver = message => { for (const socket of window.__socialSockets) if (!socket.closed) socket.message?.({ data:JSON.stringify(message) }); };
      wx.connectSocket = () => {
        const task = { closed:false, onOpen(fn) { this.open=fn }, onMessage(fn) { this.message=fn }, onClose(fn) { this.ended=fn }, onError(fn) { this.error=fn },
          send({data,fail}) { window.__socialRoomBus({op:'send',data}).catch(error=>fail?.({errMsg:error.message})) },
          close() { if(this.closed)return; this.closed=true; void window.__socialRoomBus({op:'close'}); this.ended?.({reason:'closed'}); } };
        window.__socialSockets.push(task);
        if (!window.__socialDisconnected) window.__socialRoomBus({op:'connect'}).then(messages=>{
          if(task.closed)return; task.open?.({}); setTimeout(()=>{for(const message of messages) if(!task.closed) task.message?.({data:JSON.stringify(message)})},5);
        });
        return task;
      };
    ` }))
    await page.goto(`http://127.0.0.1:${server.address().port}/?test`)
    await page.waitForFunction(() => window.mini?.table.loaded)
    await page.locator('#native-login').click()
    await page.waitForFunction(() => window.mini.snapshot().lobbyPage === 'online')
    await tap(page, { type: 'join-listed-room', roomId })
    await page.waitForFunction(() => window.mini.snapshot().gameMode === 'online' && window.mini.snapshot().phase === 'playing' && window.mini.snapshot().online.status === 'connected')
    await page.waitForFunction(() => [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
  }
  assert.equal(connected.size, 4)
  for (const { page } of clients) await page.evaluate(() => { window.__socialSounds.length = 0; window.__socialHaptics.length = 0 })
  for (const [sender, value] of ['tomato', 'coffee', 'hammer'].entries()) {
    const target = sender + 1, page = clients[sender].page, counts = await Promise.all(clients.map(({ page }) => page.evaluate(() => ({ sounds: window.__socialSounds.length, haptics: window.__socialHaptics.length }))))
    await tap(page, { local: 'social-target', seat: 1 }); await tapProp(page, value)
    await page.waitForFunction(value => window.mini.snapshot().socialEvents.at(-1)?.value === value, value)
    const event = broadcasts.at(-1), states = await eventsAfter(event.id)
    assert.equal(event.seat, sender); assert.equal(event.targetSeat, target); checkRotations(event, states)
    const hit = { tomato: 900, coffee: 1280, hammer: 1120 }[value]
    await page.waitForFunction(({ id, hit }) => Date.now() - window.mini.hud.state.socialEvents.find(event => event.id === id).receivedAt >= hit + 80, { id: event.id, hit })
    const frames = []
    for (const [viewer, client] of clients.entries()) {
      const pixels = await client.page.evaluate(({ id, hit }) => {
        const hud = window.mini.hud, event = hud.state.socialEvents.find(item => item.id === id), now = event.receivedAt + hit + 100
        hud.socialMuted = true; hud.render(now)
        const baseline = hud.ctx.getImageData(0, 0, hud.canvas.width, hud.canvas.height)
        hud.socialMuted = false; hud.render(now)
        const active = hud.ctx.getImageData(0, 0, hud.canvas.width, hud.canvas.height), card = hud.layout.seats[event.targetSeat]
        const stacked = card.w < 80, size = stacked ? 24 : Math.min(card.h - 12, 32), x = stacked ? card.x + (card.w - size) / 2 : card.x + 6, y = card.y + (stacked ? 4 : 6)
        let changed = 0
        for (let py = Math.ceil(y); py < y + size; py++) for (let px = Math.ceil(x); px < x + size; px++) {
          const index = (py * active.width + px) * 4
          if (Math.abs(active.data[index] - baseline.data[index]) + Math.abs(active.data[index+1] - baseline.data[index+1]) + Math.abs(active.data[index+2] - baseline.data[index+2]) > 20) changed++
        }
        return { changed, target: event.targetSeat }
      }, { id: event.id, hit })
      assert.ok(pixels.changed > 10, `Viewer ${viewer}: ${value} changes the target avatar`)
      frames.push({ viewer, ...pixels })
      await client.page.screenshot({ path: path.join(output, `${value}-viewer-${viewer}.png`) })
    }
    const expected = value === 'hammer' ? 2 : 1
    await Promise.all(clients.map(({ page }, viewer) => page.waitForFunction(({ value, before, expected }) => window.__socialSounds.slice(before).filter(sound => sound.source.endsWith('social_' + value + '.wav')).length >= expected, { value, before: counts[viewer].sounds, expected })))
    await clients[target].page.waitForFunction(({ before, expected }) => window.__socialHaptics.length >= before + expected, { before: counts[target].haptics, expected })
    const feedback = await Promise.all(clients.map(({ page }, viewer) => page.evaluate(before => ({ sounds: window.__socialSounds.slice(before.sounds), haptics: window.__socialHaptics.slice(before.haptics) }), counts[viewer])))
    for (const [viewer, cue] of feedback.entries()) {
      assert.equal(cue.sounds.filter(sound => sound.source.endsWith('social_throw.wav')).length, 1)
      assert.equal(cue.sounds.filter(sound => sound.source.endsWith(`social_${value}.wav`)).length, value === 'hammer' ? 2 : 1)
      assert.equal(cue.haptics.length, viewer === target ? (value === 'hammer' ? 2 : 1) : 0, `Only hit player ${target} gets haptics`)
    }
    // A duplicate server echo cannot replay animation history or feedback.
    await Promise.all([...connected].map(seat => deliver(seat, event)))
    const duplicates = await Promise.all(clients.map(({ page }) => page.evaluate(id => window.mini.snapshot().socialEvents.filter(event => event.id === id).length, event.id)))
    assert.deepEqual(duplicates, [1, 1, 1, 1])
    report.interactions.push({ event, rotations: states.map(state => state.event), frames, feedback })
  }
  for (const [sender, category, value] of [[3, 'text', '四个玩家都能看到这条消息'], [0, 'phrase', 'hello'], [1, 'emoji', 'like']]) {
    const page = clients[sender].page
    await tap(page, { local: 'social' })
    if (category === 'text') { page.once('dialog', dialog => dialog.accept(value)); await tap(page, { type: 'social-text' }) }
    else { await tap(page, { local: 'social-tab', value: category }); await tapProp(page, value) }
    await page.waitForFunction(value => window.mini.snapshot().socialEvents.at(-1)?.value === value, value)
    const event = broadcasts.at(-1), states = await eventsAfter(event.id)
    checkRotations(event, states); report.messages.push({ event, rotations: states.map(state => state.event) })
  }
  const offline = clients[3].page
  await offline.evaluate(() => { window.__socialDisconnected = true; window.__socialSockets.find(socket => !socket.closed)?.close() })
  await offline.waitForFunction(() => window.mini.snapshot().online.status !== 'connected')
  const beforeOffline = sent.filter(message => message.type === 'room_social').length
  await tap(offline, { local: 'social-target', seat: 1 })
  assert.equal(await offline.evaluate(() => window.mini.hud.hitRegions.filter(hit => hit.action.type === 'social-send').length), 0)
  await offline.evaluate(() => window.mini.dispatch({ type: 'social-send', payload: { category: 'prop', value: 'tomato', targetSeat: 1 } }))
  assert.equal(sent.filter(message => message.type === 'room_social').length, beforeOffline)
  assert.ok(await offline.evaluate(() => window.__socialToasts.some(toast => toast.includes('检查连接'))))
  report.disconnected = { prevented: true, sendCount: beforeOffline }
  const leaving = clients[2].page
  await tap(leaving, { local: 'leave-online' }); await tap(leaving, { type: 'leave-room' })
  await leaving.waitForFunction(() => window.mini.snapshot().phase === 'lobby' && window.mini.snapshot().gameMode === 'local')
  assert.equal(await leaving.evaluate(() => window.mini.snapshot().socialEvents.length), 0)
  const beforeLeave = sent.filter(message => message.type === 'room_social').length
  await leaving.evaluate(() => window.mini.dispatch({ type: 'social-send', payload: { category: 'text', value: '退出后的过期发送' } }))
  assert.equal(sent.filter(message => message.type === 'room_social').length, beforeLeave)
  report.left = { prevented: true, sendCount: beforeLeave }
  for (const client of clients) assert.deepEqual(client.errors, [], `No runtime errors for client ${client.seat}`)
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, requests, sent, broadcasts }, null, 2))
  console.log(`PASS: four authenticated native clients; real HUD sends and shared room broadcasts; seat rotation, all prop animation/audio, target-only haptics, duplicate suppression, text/phrase/emoji, offline and leave guards. Evidence: ${output}`)
} finally {
  for (const { page } of clients) await page.evaluate(() => window.mini?.dispose()).catch(() => {})
  await browser.close(); server.close()
}
