import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPreviewServer } from './preview.mjs'

// Run after `pnpm build:mini`. Only this browser test controls the HUD clock;
// the production bundle and its touch dispatch remain unchanged.
const output = path.resolve('docs/evidence/miniprogram-social-v2')
const effects = [
  { id: 'tomato', title: '番茄', duration: 2900, flight: 460, impact: 1100, residue: 1950, target: 1 },
  { id: 'coffee', title: '咖啡', duration: 3600, flight: 430, impact: 1550, residue: 2600, target: 2 },
  { id: 'hammer', title: '锤子', duration: 3050, flight: 470, impact: 1150, residue: 1950, target: 3 },
]
const sizes = [{ width: 844, height: 390 }, { width: 667, height: 320 }]
const summary = { sizes: [], errors: [], files: [] }

function crc32(bytes) {
  let result = 0xffffffff
  for (const byte of bytes) {
    result ^= byte
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0)
  }
  return (result ^ 0xffffffff) >>> 0
}
function chunk(type, payload) {
  const name = Buffer.from(type), data = Buffer.alloc(payload.length + 12)
  data.writeUInt32BE(payload.length); name.copy(data, 4); payload.copy(data, 8)
  data.writeUInt32BE(crc32(Buffer.concat([name, payload])), payload.length + 8)
  return data
}
function pngChunks(png) {
  const result = []
  for (let index = 8; index < png.length;) {
    const length = png.readUInt32BE(index), type = png.toString('ascii', index + 4, index + 8)
    result.push({ type, data: png.subarray(index + 8, index + 8 + length) }); index += length + 12
  }
  return result
}
function animatedPng(frames, frameDelay = 100) {
  const parsed = frames.map(pngChunks), header = parsed[0].find(item => item.type === 'IHDR').data
  const animation = Buffer.alloc(8); animation.writeUInt32BE(frames.length); animation.writeUInt32BE(0, 4)
  const result = [frames[0].subarray(0, 8), chunk('IHDR', header)]
  // Keep color-space metadata before animation data, as in the screenshot PNG.
  for (const item of parsed[0]) if (['sRGB', 'gAMA', 'cHRM', 'iCCP', 'PLTE', 'tRNS'].includes(item.type)) result.push(chunk(item.type, item.data))
  result.push(chunk('acTL', animation))
  let sequence = 0
  for (const [index, pieces] of parsed.entries()) {
    assert.deepEqual(pieces.find(item => item.type === 'IHDR').data, header, 'APNG frames must share dimensions and color format')
    const control = Buffer.alloc(26)
    control.writeUInt32BE(sequence++); control.writeUInt32BE(header.readUInt32BE(0), 4); control.writeUInt32BE(header.readUInt32BE(4), 8)
    control.writeUInt16BE(frameDelay, 20); control.writeUInt16BE(1000, 22)
    result.push(chunk('fcTL', control))
    for (const piece of pieces.filter(item => item.type === 'IDAT')) {
      if (!index) result.push(chunk('IDAT', piece.data))
      else {
        const data = Buffer.alloc(piece.data.length + 4); data.writeUInt32BE(sequence++); piece.data.copy(data, 4)
        result.push(chunk('fdAT', data))
      }
    }
  }
  result.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(result)
}

const server = createPreviewServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.MINI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}), headless: true })
await mkdir(output, { recursive: true })
try {
  for (const size of sizes) {
    const tag = `${size.width}x${size.height}`
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/?test&fast`)
    await page.waitForFunction(() => window.mini?.table.loaded)
    const tap = async filter => {
      await page.waitForFunction(filter => window.mini.hud.hitRegions.some(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
      const hit = await page.evaluate(filter => window.mini.hud.hitRegions.find(hit => Object.entries(filter).every(([key, value]) => hit.action[key] === value)), filter)
      await page.touchscreen.tap(hit.x + hit.w / 2, hit.y + hit.h / 2)
    }
    await tap({ type: 'lobby-page', value: 'local' }); await tap({ type: 'start' })
    await page.waitForFunction(() => window.mini.snapshot().isUserTurn)
    await page.waitForFunction(() => [...window.mini.hud.images.values()].every(image => image.ready || image.failed))
    await page.evaluate(() => {
      const hud = window.mini.hud, render = hud.render.bind(hud), update = hud.update.bind(hud)
      window.__socialPreview = { state: null, now: Date.now(), raw: hud.state, render }
      hud.render = now => render(window.__socialPreview.state ? window.__socialPreview.now : now)
      hud.update = state => { window.__socialPreview.raw = state; update(window.__socialPreview.state || state) }
    })
    const present = async (event, age) => page.evaluate(async ({ event, age }) => {
      const preview = window.__socialPreview, mini = window.mini
      preview.now = event.receivedAt + age
      preview.state = { ...preview.raw, socialEvents: [event] }
      mini.hud.state = preview.state; mini.hud.render(preview.now)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, { event, age })
    const measure = async (event, age) => page.evaluate(({ event, age }) => {
      const hud = window.mini.hud, ctx = hud.ctx, preview = window.__socialPreview
      preview.now = event.receivedAt + age; preview.state = { ...preview.raw, socialEvents: [event] }
      hud.state = preview.state
      hud.socialMuted = true; hud.render(preview.now)
      const baseline = ctx.getImageData(0, 0, hud.canvas.width, hud.canvas.height)
      hud.socialMuted = false; hud.render(preview.now)
      const frame = ctx.getImageData(0, 0, hud.canvas.width, hud.canvas.height)
      const rel = (event.targetSeat - (hud.state.user?.seat ?? 0) + 4) % 4, card = hud.layout.seats[rel]
      const stacked = card.w < 80, side = stacked ? 24 : Math.min(card.h - 12, 32)
      const avatar = { x: stacked ? card.x + (card.w - side) / 2 : card.x + 6, y: card.y + (stacked ? 4 : 6), w: side, h: side }
      let changed = 0, avatarChanged = 0, checksum = 2166136261
      for (let index = 0; index < frame.data.length; index += 4) {
        checksum = Math.imul(checksum ^ frame.data[index], 16777619) >>> 0
        checksum = Math.imul(checksum ^ frame.data[index + 1], 16777619) >>> 0
        checksum = Math.imul(checksum ^ frame.data[index + 2], 16777619) >>> 0
        const delta = Math.abs(frame.data[index] - baseline.data[index]) + Math.abs(frame.data[index + 1] - baseline.data[index + 1]) + Math.abs(frame.data[index + 2] - baseline.data[index + 2]) + Math.abs(frame.data[index + 3] - baseline.data[index + 3])
        if (delta <= 25) continue
        changed++
        const x = index / 4 % frame.width / hud.dpr, y = Math.floor(index / 4 / frame.width) / hud.dpr
        if (x >= avatar.x && x < avatar.x + avatar.w && y >= avatar.y && y < avatar.y + avatar.h) avatarChanged++
      }
      return { changed, avatarChanged, checksum, avatar, relativeSeat: rel }
    }, { event, age })
    const sizeResult = { ...size, effects: [] }
    for (const [index, effect] of effects.entries()) {
      if (index) await page.waitForTimeout(2100)
      await page.evaluate(() => {
        const mini = window.mini, preview = window.__socialPreview
        preview.state = null; mini.hud.update({ ...mini.snapshot(), socialEvents: [] }); mini.hud.modal = null; mini.hud.render()
      })
      await tap({ local: 'social-target', seat: effect.target })
      const prop = await page.evaluate(id => window.mini.hud.hitRegions.find(hit => hit.action.payload?.value === id), effect.id)
      assert.ok(prop, `${tag}: ${effect.id} prop action is available`)
      await page.touchscreen.tap(prop.x + prop.w / 2, prop.y + prop.h / 2)
      await page.waitForFunction(id => window.mini.hud.state.socialEvents.at(-1)?.value === id, effect.id)
      const event = await page.evaluate(() => window.mini.hud.state.socialEvents.at(-1))
      assert.equal(event.seat, 0); assert.equal(event.targetSeat, effect.target)
      const result = { id: effect.id, touchTarget: effect.target, frames: [], targets: [] }
      for (const [name, age] of [['flight', effect.flight], ['impact', effect.impact], ['residue', effect.residue]]) {
        const stats = await measure(event, age)
        assert.ok(stats.changed > 80, `${tag}: ${effect.id}/${name} draws an effect`)
        result.frames.push({ name, age, ...stats })
        await present(event, age)
        const file = `${effect.id}-${tag}-${name}.png`
        await page.screenshot({ path: path.join(output, file) }); summary.files.push(file)
      }
      assert.equal(new Set(result.frames.map(frame => frame.checksum)).size, 3, `${tag}: ${effect.id} moves between phases`)
      for (let target = 0; target < 4; target++) {
        // Replay the real protocol payload in the test process to cover incoming
        // interactions and all four relative HUD anchors, including our 0 seat.
        const incoming = { ...event, seat: (target + 1) % 4, targetSeat: target }
        const stats = await measure(incoming, effect.impact)
        assert.ok(stats.avatarChanged > 10, `${tag}: ${effect.id} reacts on target avatar ${target}`)
        result.targets.push({ seat: target, ...stats })
        if (target !== effect.target) {
          await present(incoming, effect.impact)
          const file = `${effect.id}-${tag}-${target ? `seat-${target}` : 'self'}-impact.png`
          await page.screenshot({ path: path.join(output, file) }); summary.files.push(file)
        }
      }
      const finished = await measure(event, effect.duration + 20)
      assert.equal(finished.changed, 0, `${tag}: ${effect.id} removes its effect after the lifetime`)
      const animationFrames = []
      for (let age = 0; age <= effect.duration + 300; age += 100) {
        await present(event, age); animationFrames.push(await page.screenshot())
      }
      const animationFile = `${effect.id}-${tag}.png`
      await writeFile(path.join(output, animationFile), animatedPng(animationFrames)); summary.files.push(animationFile)
      sizeResult.effects.push(result)
    }
    assert.deepEqual(errors, [], `${tag}: no runtime errors`)
    summary.errors.push(...errors); summary.sizes.push(sizeResult)
    await page.evaluate(() => window.mini.dispose()); await page.close()
  }
  const cards = sizes.flatMap(size => effects.map(effect => `<article><h2>${effect.title} · ${size.width} × ${size.height}</h2><img src="${effect.id}-${size.width}x${size.height}.png" alt="${effect.title}互动动画"></article>`)).join('\n')
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>互动动效验收</title><style>body{margin:24px;background:#071a12;color:#f1ead8;font:15px system-ui}h1{font-size:22px}h2{font-size:14px;font-weight:500}article{margin:0 0 28px}img{display:block;max-width:100%;border-radius:12px;border:1px solid #315540}</style><h1>番茄、咖啡与锤子互动动效</h1><p>由微信小游戏实际构建包和原生触摸发送，按固定时钟采集动画。每幅图循环播放。</p>${cards}</html>`)
  const viewer = await browser.newPage({ viewport: { width: 920, height: 500 } })
  await viewer.goto(pathToFileURL(path.join(output, 'index.html')).href)
  await viewer.waitForFunction(() => [...document.images].length === 6 && [...document.images].every(image => image.complete && image.naturalWidth > 0))
  const animation = viewer.locator('img').first(), firstFrame = await animation.screenshot()
  await viewer.waitForTimeout(750)
  assert.notDeepEqual(await animation.screenshot(), firstFrame, 'The delivered APNG must decode and play in the browser')
  await viewer.close()
  summary.animationPlayback = 'Browser decoded all six APNG files and the first animation changed frames.'
  await writeFile(path.join(output, 'report.json'), JSON.stringify(summary, null, 2))
  console.log(`PASS: native touch sends; flight, impact and residue change over time; all four avatars react; compact and regular screens; cleanup; no runtime errors. Evidence: ${output}`)
} finally { await browser.close(); server.close() }
