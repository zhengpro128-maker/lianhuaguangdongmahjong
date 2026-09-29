import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createPreviewServer } from './preview.mjs'

const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
await mkdir('docs/evidence/miniprogram-social', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/?test`)
  await page.waitForFunction(() => window.mini?.table.loaded)
  const tap = async filter => {
    await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([k, v]) => hit.action[k] === v)), filter)
    const hit = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([k, v]) => hit.action[k] === v)), filter)
    await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
  }
  await tap({ type: 'lobby-page', value: 'local' }); await tap({ type: 'start' })
  await page.waitForFunction(() => window.mini.snapshot().isUserTurn)
  await tap({ local: 'social' })
  await page.screenshot({ path: 'docs/evidence/miniprogram-social/chat.png' })
  await tap({ type: 'social-send' })
  await page.waitForFunction(() => window.mini.snapshot().socialEvents.length === 1)
  await page.screenshot({ path: 'docs/evidence/miniprogram-social/bubble.png' })
  await page.waitForTimeout(2100)
  await tap({ local: 'social' })
  page.once('dialog', dialog => dialog.accept('大家好，今天手气不错！'))
  await tap({ type: 'social-text' })
  await page.waitForFunction(() => window.mini.snapshot().socialEvents.some(event => event.category === 'text'))
  for (const [index, prop] of ['tomato', 'coffee', 'hammer'].entries()) {
    await page.waitForTimeout(2100)
    await tap({ local: 'social-target', seat: index + 1 })
    if (!index) await page.screenshot({ path: 'docs/evidence/miniprogram-social/props.png' })
    const hit = await page.evaluate(prop => window.mini.hud.hits.find(hit => hit.action.payload?.value === prop), prop)
    await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
    await page.waitForFunction(prop => window.mini.snapshot().socialEvents.at(-1)?.value === prop, prop)
    await page.waitForTimeout(800)
    await page.screenshot({ path: `docs/evidence/miniprogram-social/${prop}.png` })
  }
  await page.setViewportSize({ width: 667, height: 320 })
  await page.waitForFunction(() => window.mini.hud.width === 667 && window.mini.hud.height === 320)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await tap({ local: 'social' })
  await tap({ local: 'social-tab', value: 'history' })
  await page.screenshot({ path: 'docs/evidence/miniprogram-social/history-small.png' })
  await tap({ local: 'social-tab', value: 'emoji' })
  await page.screenshot({ path: 'docs/evidence/miniprogram-social/emoji-small.png' })
  await page.evaluate(() => window.mini.dispose())
  assert.deepEqual(errors, [])
  console.log('PASS: phrases, native text input, all three target props, message history, emoji panel and compact layout; no runtime errors.')
} finally { await browser.close(); server.close() }
