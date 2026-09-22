import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createPreviewServer } from './preview.mjs'

const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = process.env.MINI_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
const browser = await chromium.launch({ ...(chrome && existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
const evidence = path.resolve('docs/evidence/miniprogram')
await mkdir(evidence, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const errors = [], missing = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()) })
  await page.goto(`${origin}/?test`)
  await page.waitForFunction(() => window.mini?.table.loaded)
  await page.waitForFunction(() => [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
  const tap = async filter => {
    await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
    const box = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
    assert.ok(box, `Missing action: ${JSON.stringify(filter)}`)
    await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2)
  }
  assert.equal(await page.evaluate(() => window.mini.snapshot().phase), 'lobby')
  await page.screenshot({ path: path.join(evidence, 'mini-lobby.png') })
  await tap({ type: 'match', value: 'hanchan' })
  await page.waitForFunction(() => window.mini.snapshot().settings.matchType === 'hanchan')
  await tap({ local: 'rules' })
  await page.screenshot({ path: path.join(evidence, 'mini-rules.png') })
  await tap({ local: 'close' })
  await tap({ type: 'match', value: 'east' })
  await tap({ type: 'start' })
  await page.waitForFunction(() => window.mini.snapshot().isUserTurn, { timeout: 20000 })
  const initial = await page.evaluate(() => {
    const s = window.mini.snapshot()
    return { count: s.players[0].hand.length, wall: s.wall.length,
      total: s.wall.length + s.players.reduce((n,p) => n + p.hand.length + p.discards.length + p.melds.reduce((n,m) => n + m.tiles.length, 0), 0) }
  })
  assert.equal(initial.count, 14); assert.equal(initial.total, 120)
  await page.screenshot({ path: path.join(evidence, 'mini-table.png') })
  const chosen = await page.evaluate(() => {
    const s = window.mini.snapshot()
    return s.user.hand.findIndex(tile => tile !== 'red' && !s.jokerTiles.includes(tile))
  })
  await tap({ type: 'select', index: chosen })
  await page.waitForFunction(index => window.mini.snapshot().selectedIndex === index, chosen)
  await tap({ type: 'discard', index: chosen })
  await page.waitForFunction(() => window.mini.snapshot().players[0].discards.length === 1)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForFunction(() => window.mini.hud.width === 1024)
  await page.screenshot({ path: path.join(evidence, 'mini-table-tablet.png') })
  await page.setViewportSize({ width: 667, height: 375 })
  await page.waitForFunction(() => window.mini.hud.width === 667)
  await page.screenshot({ path: path.join(evidence, 'mini-table-small.png') })
  await tap({ local: 'leave' })
  await tap({ type: 'lobby' })
  await page.waitForFunction(() => window.mini.snapshot().phase === 'lobby')
  await page.screenshot({ path: path.join(evidence, 'mini-lobby-small.png') })
  await page.evaluate(() => window.mini.dispose())
  assert.deepEqual(errors, [], 'No runtime exceptions')
  assert.deepEqual(missing, [], 'All bundled assets load')
  console.log('PASS: lobby, match selection, rules, native touches, 120-tile deal, select/discard, phone/tablet resize, leave/cleanup; no runtime errors or missing assets.')
} finally { await browser.close(); server.close() }
