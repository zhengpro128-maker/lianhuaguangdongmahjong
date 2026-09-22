import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createPreviewServer } from './preview.mjs'
const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
const browser = await chromium.launch({ ...(chrome && existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/?test&fast`)
  await page.waitForFunction(() => window.mini?.table.loaded)
  await page.evaluate(() => window.mini.dispatch({ type: 'start' }))
  await page.waitForFunction(() => window.mini.snapshot().isUserTurn)
  await page.evaluate(() => window.mini.dispatch({ type: 'auto' }))
  await page.waitForFunction(() => window.mini.snapshot().phase === 'settled', null, { timeout: 90000 })
  const result = await page.evaluate(() => {
    const state = window.mini.snapshot()
    return { result: state.result, total: state.players.reduce((sum, p) => sum + p.score, 0),
      tiles: state.wall.length + state.players.reduce((n,p) => n+p.hand.length+p.discards.length+p.melds.reduce((n,m)=>n+m.tiles.length,0),0)+(state.winPresentation?.discardWin ? 1 : 0) }
  })
  assert.equal(result.total, 4000)
  assert.equal(result.tiles, 120)
  assert.equal(result.result.scoreChanges.length, 4)
  await page.waitForFunction(() => window.mini.hud.hitRegions.some(hit => hit.action.type === 'next'))
  await mkdir('docs/evidence/miniprogram', { recursive: true })
  await page.screenshot({ path: 'docs/evidence/miniprogram/mini-settlement.png' })
  await page.setViewportSize({ width: 667, height: 375 })
  await page.waitForFunction(() => window.mini.hud.width === 667)
  await page.screenshot({ path: 'docs/evidence/miniprogram/mini-settlement-small.png' })
  await page.evaluate(() => window.mini.dispatch({ type: 'next' }))
  await page.waitForFunction(() => window.mini.snapshot().result === null)
  await page.evaluate(() => { window.mini.dispatch({ type: 'lobby' }); window.mini.dispose() })
  assert.deepEqual(errors, [])
  console.log('PASS: shared-engine autoplay reaches real settlement, all 120 tiles conserved, score total 4000, four-player score rows, phone settlement layout and next round.')
} finally { await browser.close(); server.close() }
