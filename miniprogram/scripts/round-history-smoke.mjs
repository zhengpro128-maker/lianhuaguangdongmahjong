// Four built Mini Game clients receive authoritative snapshots through the
// native socket adapter. Only wx authentication/network/audio are substituted.
import { build } from 'vite'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPreviewServer } from './preview.mjs'

const roomId = 'ABC234', clients = [], connected = new Set()
const output = path.resolve('docs/evidence/miniprogram-round-history')
const names = ['阿诚', '小雨今天也要好好打牌', '老陈', '大海']
const avatars = ['lotus', 'ah-lok', 'shisan', 'young-master']
let history = [], supportsHistory = true, finished = false
const hand = ['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'm6', 'm7', 'p8', 'p9']
const info = () => ({ roomId, mode: 'rounds16', rulesetId: 'wuhan-huanghuang', capacity: 4, creatorSeat: 0, status: 'playing',
  seats: names.map((nickname, seat) => ({ seat, nickname, ready: true, connected: connected.has(seat) })) })
const snapshot = viewer => ({ kind: 'state_snapshot', roomId, mode: 'rounds16', rulesetId: 'wuhan-huanghuang',
  phase: finished ? 'finished' : 'drawing', round: Math.min(16, history.length + 1), dealer: 0, honba: 0,
  wallCount: 80, wall: [], headDrawn: 0, currentPlayer: 0, seat: viewer,
  flipTile: 'm9', jokerTiles: ['m1'], wildcardTiles: ['m1'], flipStack: null, openingStack: null,
  result: null, announcement: null, matchFinished: finished, lastDiscard: null, winPresentation: null, winningPlayerIndex: -1,
  ...(supportsHistory ? { roundHistory: history } : {}),
  players: names.map((name, seat) => ({ seat, name: `${name}（当前资料）`, avatar: `https://mini.test/avatar-${seat}.png`, score: 0,
    hand: seat === viewer ? [...hand] : hand.map(() => null), discards: [], melds: [], redCount: 0, drawnTileIndex: -1 })) })
const record = (round, overrides = {}) => ({ id: `1:${round}`, round, roundLabel: `第 ${round} 局`, dealer: (round - 1) % 4, honba: 0,
  winnerIndex: 1, winner: names[1], winType: 'self-draw', totalWon: 12,
  details: [{ label: '底分·七对', points: 4 }, { label: '硬胡', multiplier: 2 }],
  scoreChanges: names.map((name, playerIndex) => ({ playerIndex, name, avatar: `https://mini.test/avatar-${playerIndex}.png`,
    playerKind: 'human', score: [-7, 13, -3, -3][playerIndex] * round, delta: [-7, 13, -3, -3][playerIndex] })), ...overrides })

const built = await build({ configFile: 'miniprogram/vite.config.mjs', logLevel: 'error',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('https://mini.test') }, build: { write: false } })
const bundle = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk').code
const shim = await readFile(new URL('../preview/wx-shim.js', import.meta.url), 'utf8')
const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
const browser = await chromium.launch({ ...(chrome && existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
await mkdir(output, { recursive: true })
const report = { clients: [], pagination: [], reconnect: null, finished: null, errors: [] }
async function deliver(seat, message) { await clients[seat].page.evaluate(value => window.__historyDeliver(value), message) }
async function publish() { await Promise.all([...connected].map(seat => deliver(seat, snapshot(seat)))) }
async function tap(page, action) {
  await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), action)
  const hit = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), action)
  await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
}
async function waitHistory(length) {
  await Promise.all([...connected].map(seat => clients[seat].page.waitForFunction(count => window.mini.snapshot().roundHistory.length === count, length)))
}

try {
  for (let seat = 0; seat < 4; seat++) {
    const page = await browser.newPage({ viewport: seat < 2 ? { width: 844, height: 390 } : { width: 667, height: 320 },
      deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    clients.push({ page, seat }); page.on('pageerror', error => report.errors.push({ seat, message: error.message }))
    await page.exposeBinding('__historyBus', async (_source, packet) => {
      if (packet.op === 'request') {
        const requestPath = new URL(packet.url).pathname
        if (requestPath.endsWith('/login')) return { sessionToken: `session-${seat}`, account: { id: `account-${seat}`, displayName: names[seat], avatarUrl: `https://mini.test/avatar-${seat}.png` } }
        assert.equal(packet.header?.Authorization, `Bearer session-${seat}`)
        if (requestPath === '/api/rooms') return { rooms: [{ ...info(), status: 'lobby', occupied: 3 }] }
        if (requestPath.endsWith('/join')) return { roomId, seat, nickname: names[seat], playerId: `account-${seat}`, rejoinCode: `rejoin-${seat}`, rejoin: false }
        if (requestPath === `/api/rooms/${roomId}`) return info()
        throw new Error(`Unexpected request ${requestPath}`)
      }
      if (packet.op === 'connect') {
        connected.add(seat)
        return [{ kind: 'rejoin_ok', roomId, seat, mode: 'rounds16', rulesetId: 'wuhan-huanghuang', nickname: names[seat], rejoinCode: `rejoin-${seat}`, rejoin: true }, snapshot(seat)]
      }
      if (packet.op === 'close') { connected.delete(seat); return true }
      if (packet.op === 'send') {
        const message = JSON.parse(packet.data)
        if (message.type === 'ping') await deliver(seat, { kind: 'pong', t: message.t })
        return true
      }
      throw new Error(`Unexpected operation ${packet.op}`)
    })
    await page.route('**/js/game.bundle.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }))
    await page.route('https://mini.test/avatar-*.png', route => {
      const index = Number(new URL(route.request().url()).pathname.match(/avatar-(\d)/)[1])
      return route.fulfill({ path: new URL(`../assets/avatars/${avatars[index]}.png`, import.meta.url).pathname,
        headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route('**/preview/wx-shim.js', route => route.fulfill({ contentType: 'application/javascript', body: shim + `
      window.__historySockets = [];
      wx.createUserInfoButton = options => {
        const button = document.createElement('button'); button.id = 'native-login';
        Object.assign(button.style, { position:'fixed', border:'none', background:'transparent' });
        const style = new Proxy({}, { set(target,key,value) { target[key]=value; button.style[key]=['left','top','width','height','lineHeight'].includes(key) ? value+'px' : value; return true; } });
        Object.assign(style,options.style); document.body.append(button);
        return { style, show:()=>button.style.display='block', hide:()=>button.style.display='none', destroy:()=>button.remove(),
          onTap:fn=>button.onclick=()=>fn({ userInfo:{ nickName:${JSON.stringify(names[seat])}, avatarUrl:'https://mini.test/avatar-${seat}.png' } }) };
      };
      wx.login = options => options.success({ code:'code-${seat}' });
      wx.request = options => window.__historyBus({op:'request',url:options.url,method:options.method||'GET',data:options.data,header:options.header}).then(data=>options.success({statusCode:200,data}),error=>options.fail?.({errMsg:error.message}));
      wx.createInnerAudioContext = () => ({ onEnded(fn){this.ended=fn},onError(){},onStop(){},play(){Promise.resolve().then(()=>this.ended?.())},destroy(){} });
      window.__historyDeliver = message => { for (const socket of window.__historySockets) if(!socket.closed) socket.message?.({data:JSON.stringify(message)}); };
      wx.connectSocket = () => {
        const task = {closed:false,onOpen(fn){this.open=fn},onMessage(fn){this.message=fn},onClose(fn){this.ended=fn},onError(fn){this.error=fn},
          send({data,fail}){window.__historyBus({op:'send',data}).catch(error=>fail?.({errMsg:error.message}))},
          close(){if(this.closed)return;this.closed=true;void window.__historyBus({op:'close'});this.ended?.({reason:'closed'})}};
        window.__historySockets.push(task);
        if(!window.__historyOffline) window.__historyBus({op:'connect'}).then(messages=>{if(task.closed)return;task.open?.({});setTimeout(()=>{for(const message of messages)if(!task.closed)task.message?.({data:JSON.stringify(message)})},5)});
        return task;
      };
    ` }))
    await page.goto(`http://127.0.0.1:${server.address().port}/?test`)
    await page.waitForFunction(() => window.mini?.table.loaded)
    await page.locator('#native-login').click()
    await page.waitForFunction(() => window.mini.snapshot().lobbyPage === 'online')
    await tap(page, { type: 'join-listed-room', roomId })
    await page.waitForFunction(() => window.mini.snapshot().gameMode === 'online' && window.mini.snapshot().phase === 'playing')
    await tap(page, { local: 'round-history' })
    assert.equal(await page.evaluate(() => window.mini.snapshot().roundHistoryAvailable), true)
    assert.equal(await page.evaluate(() => window.mini.hud.handHits.length), 0)
    if (seat === 0) await page.screenshot({ path: path.join(output, 'history-empty.png') })
    await tap(page, { local: 'close' })
  }
  assert.equal(connected.size, 4)
  history = [record(1), record(2, { draw: true, winnerIndex: -1, details: [], winType: undefined, totalWon: 0 }), record(3)]
  await publish(); await waitHistory(3); await publish(); await waitHistory(3)
  for (const { page, seat } of clients) {
    await tap(page, { local: 'round-history' })
    await page.waitForFunction(() => [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
    const state = await page.evaluate(() => ({ history: window.mini.snapshot().roundHistory, panel: window.mini.hud.historyPanel,
      selected: window.mini.hud.historySelectedId, actions: window.mini.hud.hitRegions.map(hit => hit.action),
      loaded: [...window.mini.hud.images.entries()].filter(([url, image]) => url.startsWith('https://mini.test') && image.ready).map(([url]) => url) }))
    assert.equal(state.selected, '1:3')
    assert.equal(state.history[0].winnerIndex, (1 - seat + 4) % 4)
    assert.equal(state.history[0].dealer, (0 - seat + 4) % 4)
    for (const entry of state.history[0].scoreChanges) {
      const absolute = (entry.playerIndex + seat) % 4
      assert.equal(entry.name, names[absolute]); assert.equal(entry.avatar, `https://mini.test/avatar-${absolute}.png`)
      assert.equal(entry.delta, [-7, 13, -3, -3][absolute])
      assert.ok(state.loaded.includes(entry.avatar), `Viewer ${seat}: historical profile is loaded`)
    }
    assert.ok(state.actions.every(action => ['close', 'history-select', 'history-page', 'history-step'].includes(action.local)))
    assert.ok(state.panel.x >= 0 && state.panel.y >= 0 && state.panel.x + state.panel.w <= (seat < 2 ? 844 : 667))
    report.clients.push({ seat, winner: state.history[0].winnerIndex, profiles: state.history[0].scoreChanges, panel: state.panel })
    if (seat === 0 || seat === 2) await page.screenshot({ path: path.join(output, `history-${seat < 2 ? '844x390' : '667x320'}.png`) })
    await tap(page, { local: 'history-select', id: '1:2' })
    assert.equal(await page.evaluate(() => window.mini.hud.historySelectedId), '1:2')
    if (seat === 0) await page.screenshot({ path: path.join(output, 'history-draw.png') })
    await tap(page, { local: 'close' })
  }
  const offline = clients[3].page
  await offline.evaluate(() => { window.__historyOffline = true; window.__historySockets.find(socket => !socket.closed)?.close() })
  await offline.waitForFunction(() => window.mini.snapshot().online.status !== 'connected')
  history = Array.from({ length: 16 }, (_, index) => record(index + 1))
  history[15] = record(16, { details: ['清一色', '门前清', '龙七对', '杠上开花'].map(label => ({ label: `底分·${label}`, points: 4 })), kongBloom: true })
  await publish(); await waitHistory(16)
  await offline.reload()
  await offline.waitForFunction(() => window.mini?.table.loaded)
  await offline.locator('#native-login').click()
  await offline.waitForFunction(() => window.mini.snapshot().lobbyPage === 'online')
  await tap(offline, { type: 'join-listed-room', roomId })
  await offline.waitForFunction(() => window.mini.snapshot().roundHistory.length === 16 && window.mini.snapshot().online.mySeat === 3)
  report.reconnect = { restored: await offline.evaluate(() => window.mini.snapshot().roundHistory.length), seat: 3 }
  for (const viewer of [0, 2]) {
    const page = clients[viewer].page
    await tap(page, { local: 'round-history' })
    // Opening preserves a previously chosen hand. Navigate through the actual
    // controls to the latest hand before checking its combined special badges.
    while (await page.evaluate(() => window.mini.hud.historySelectedId !== '1:16')) {
      await tap(page, { local: 'history-step', step: -1 })
    }
    await page.waitForFunction(() => [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
    await page.screenshot({ path: path.join(output, `history-16-${viewer < 2 ? '844x390' : '667x320'}.png`) })
    await tap(page, { local: 'history-page', step: 1 })
    const middle = await page.evaluate(() => window.mini.hud.hitRegions.filter(hit => hit.action.local === 'history-select').map(hit => hit.action.id))
    await tap(page, { local: 'history-select', id: middle.at(-1) })
    assert.equal(await page.evaluate(() => window.mini.hud.historySelectedId), middle.at(-1))
    report.pagination.push({ viewer, middle })
    await tap(page, { local: 'close' })
  }
  finished = true; await publish(); await waitHistory(16)
  report.finished = await clients[0].page.evaluate(() => ({ phase: window.mini.snapshot().phase, count: window.mini.snapshot().roundHistory.length }))
  assert.equal(report.finished.phase, 'finished')
  await tap(clients[0].page, { local: 'hide-result' })
  await tap(clients[0].page, { local: 'round-history' }); await tap(clients[0].page, { local: 'close' })
  history = []; finished = false
  for (const { seat } of clients) await deliver(seat, { kind: 'round_start', matchStarted: true, round: 1, dealer: 0, honba: 0, dice: [1, 1] })
  await publish(); await waitHistory(0)
  supportsHistory = false; await publish()
  await clients[0].page.waitForFunction(() => window.mini.snapshot().roundHistoryAvailable === false)
  assert.deepEqual(report.errors, [])
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('PASS online round history: four perspectives, frozen profiles, whole-round deltas, draw, 16 hands/pagination, reconnect, finished/new match, empty/old backend, 844×390 and 667×320.')
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
