// Native Canvas animation: every prop has a wind-up, a distinct action and a
// target reaction. All particles are deterministic so frames can be replayed.
export const SOCIAL_PROP_TIMINGS = {
  tomato: { launch: 180, hit: 900, end: 2900 },
  coffee: { launch: 180, arrive: 820, pour: 1100, hit: 1280, drain: 2050, end: 3600 },
  hammer: { launch: 120, arrive: 720, hit: 1120, secondHit: 1490, end: 3050 },
}
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const mix = (a, b, t) => a + (b - a) * t
const range = (age, start, end) => clamp((age - start) / (end - start))
const out = t => 1 - (1 - t) ** 3
const smooth = t => t * t * (3 - 2 * t)
const TAU = Math.PI * 2
const rotate = (x, y, angle) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) })
const point = (a, b, c, t) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * b.x + t * t * c.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * b.y + t * t * c.y })

export function getSocialFeedbackCues(event) {
  const timing = SOCIAL_PROP_TIMINGS[event.value]
  if (event.category !== 'prop' || !timing) return []
  const cues = [{ at: timing.launch, sound: 'social_throw.wav', volume: .38 },
    { at: event.value === 'coffee' ? timing.pour : timing.hit, sound: `social_${event.value}.wav`, volume: .65,
      ...(event.value === 'coffee' ? {} : { haptic: event.value === 'hammer' ? 'medium' : 'light' }) }]
  if (event.value === 'coffee') cues.push({ at: timing.hit, sound: '', volume: 0, haptic: 'light' })
  if (timing.secondHit) cues.push({ at: timing.secondHit, sound: 'social_hammer.wav', volume: .48, haptic: 'light' })
  return cues
}

export function activeSocialProps(events, now) {
  return (events || []).filter(e => e.category === 'prop' && SOCIAL_PROP_TIMINGS[e.value]
    && now >= e.receivedAt && now - e.receivedAt < SOCIAL_PROP_TIMINGS[e.value].end).slice(-4)
}

export function socialAvatarBounds(card) {
  const stacked = card.w < 80, size = stacked ? 24 : Math.min(card.h - 12, 32)
  return { x: stacked ? card.x + (card.w - size) / 2 : card.x + 6,
    y: card.y + (stacked ? 4 : 6), w: size, h: size }
}

export function socialSeatReaction(events, seat, now) {
  let x = 0, y = 0, rotation = 0, sx = 1, sy = 1
  for (const e of activeSocialProps(events, now)) {
    const timing = SOCIAL_PROP_TIMINGS[e.value], age = now - e.receivedAt
    if (e.seat === seat && age < timing.launch + 180) {
      const wind = Math.sin(range(age, 0, timing.launch + 180) * Math.PI)
      x -= wind * 2; rotation -= wind * .025
    }
    if (e.targetSeat !== seat) continue
    for (const hit of [timing.hit, ...(timing.secondHit ? [timing.secondHit] : [])]) {
      const elapsed = age - hit
      if (elapsed < 0 || elapsed > 700) continue
      const decay = Math.exp(-elapsed / 210), force = e.value === 'hammer' ? 1 : .65
      x += Math.sin(elapsed / 24) * 6 * decay * force
      y += Math.sin(elapsed / 35) * 4 * decay * force
      rotation += Math.sin(elapsed / 32) * .085 * decay * force
      const squash = Math.exp(-elapsed / 95) * force
      sx += squash * .1; sy -= squash * .16
    }
    if (e.value === 'coffee' && age > timing.hit && age < timing.drain + 200) {
      rotation += Math.sin(age / 75) * .015; y += Math.sin(age / 65) * 1.2
    }
  }
  return { x: clamp(x, -9, 9), y: clamp(y, -7, 7), rotation: clamp(rotation, -.12, .12),
    sx: clamp(sx, .9, 1.16), sy: clamp(sy, .78, 1.1) }
}

function ellipse(ctx, x, y, rx, ry, fill, angle = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), angle, 0, TAU)
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
}
function line(ctx, points, color, width) {
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1])
  for (const p of points.slice(1)) ctx.lineTo(p[0], p[1])
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
}
function roundRect(ctx, x, y, w, h, r, fill, border) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.7; ctx.stroke() }
}
function star(ctx, x, y, radius, color, rotation = 0) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = rotation + i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * .43 : radius
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py)
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#956128'; ctx.lineWidth = .9; ctx.stroke()
}
function splat(ctx, x, y, radius, color, seed = 0) {
  ctx.beginPath()
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * TAU, r = radius * (1 + .24 * Math.sin(a * 7 + seed) + .18 * Math.cos(a * 11 + seed))
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * .8
    if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill()
}
function tomato(ctx) {
  const color = ctx.createRadialGradient(-10, -12, 2, 0, 0, 30)
  color.addColorStop(0, '#ffb16c'); color.addColorStop(.25, '#ff6346'); color.addColorStop(.65, '#e82d24'); color.addColorStop(1, '#99120e')
  ctx.beginPath(); ctx.moveTo(0, -22)
  ctx.bezierCurveTo(-28, -31, -35, -7, -25, 14); ctx.bezierCurveTo(-18, 31, 11, 31, 25, 17)
  ctx.bezierCurveTo(39, -1, 27, -29, 0, -22); ctx.closePath()
  ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#7e2017'; ctx.lineWidth = 1.8; ctx.stroke()
  ellipse(ctx, -12, -10, 7, 4, 'rgba(255,238,206,.7)', -.7)
  line(ctx, [[-20, 10], [-13, 20], [-2, 23]], 'rgba(249,119,66,.45)', 2)
  ctx.save(); ctx.translate(0, -21)
  for (let i = 0; i < 5; i++) {
    ctx.save(); ctx.rotate(i / 5 * TAU)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-10, -2, -14, -9)
    ctx.quadraticCurveTo(-3, -9, 3, 1); ctx.closePath(); ctx.fillStyle = i % 2 ? '#579b36' : '#277531'; ctx.fill()
    ctx.restore()
  }
  line(ctx, [[0, 0], [2, -7], [8, -10]], '#335927', 4); ctx.restore()
}
function cup(ctx, fill = 1) {
  // Handle is behind the ceramic body, with a genuine opening through it.
  ctx.beginPath(); ctx.ellipse(23, 3, 14, 16, 0, -.65 * Math.PI, .65 * Math.PI)
  ctx.strokeStyle = '#acb8bb'; ctx.lineWidth = 10; ctx.stroke()
  ctx.strokeStyle = '#fff5df'; ctx.lineWidth = 6; ctx.stroke()
  const glaze = ctx.createLinearGradient(-26, 0, 27, 0)
  glaze.addColorStop(0, '#b8ced1'); glaze.addColorStop(.26, '#fff8e9'); glaze.addColorStop(.65, '#fffdf4'); glaze.addColorStop(1, '#90a6aa')
  ctx.beginPath(); ctx.moveTo(-25, -20); ctx.lineTo(-19, 23); ctx.quadraticCurveTo(0, 34, 20, 23)
  ctx.lineTo(26, -20); ctx.closePath(); ctx.fillStyle = glaze; ctx.fill(); ctx.strokeStyle = '#52696c'; ctx.lineWidth = 1.8; ctx.stroke()
  ellipse(ctx, 0, -20, 25, 9, '#fff2d9'); ctx.strokeStyle = '#75888a'; ctx.lineWidth = 1.6; ctx.stroke()
  ellipse(ctx, 0, -20 + (1 - fill) * 3, 21, 6 * (.35 + fill * .65), '#6a3520')
  ellipse(ctx, -3, -22, 14, 2.3, '#c38b53'); ellipse(ctx, 9, -19, 2, 1.2, '#f7d7a0')
  line(ctx, [[-17, -11], [-14, 15]], 'rgba(255,255,255,.85)', 3)
  ellipse(ctx, 0, 25, 15, 3, 'rgba(82,105,108,.2)')
}
function hammer(ctx) {
  const wood = ctx.createLinearGradient(-6, 0, 10, 0)
  wood.addColorStop(0, '#9a4d1e'); wood.addColorStop(.4, '#f4b553'); wood.addColorStop(1, '#b16526')
  roundRect(ctx, -6, 0, 14, 65, 5, wood, '#673b24')
  for (const y of [39, 45, 51, 57]) line(ctx, [[-4, y], [6, y - 2]], '#8c4a26', 1.5)
  const steel = ctx.createLinearGradient(0, -19, 0, 18)
  steel.addColorStop(0, '#eff9ff'); steel.addColorStop(.22, '#9eb6c5'); steel.addColorStop(.48, '#e2edf0'); steel.addColorStop(.52, '#7f949f'); steel.addColorStop(1, '#3e505c')
  roundRect(ctx, -29, -17, 59, 33, 6, steel, '#263b48')
  roundRect(ctx, -32, -18, 11, 35, 3, '#647987', '#293d49')
  roundRect(ctx, -32, -18, 8, 9, 2, '#c2d4de')
  line(ctx, [[-18, -12], [22, -12]], 'rgba(255,255,255,.82)', 2)
  roundRect(ctx, -5, -13, 12, 24, 3, '#7c959d', '#495f6a')
  ellipse(ctx, 1, -2, 2.7, 2.7, '#e4ece9')
}
export function drawSocialPropIcon(ctx, value, x, y, scale = 1, angle = 0, fill = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale)
  if (value === 'tomato') tomato(ctx)
  else if (value === 'coffee') cup(ctx, fill)
  else if (value === 'hammer') hammer(ctx)
  ctx.restore()
}

export function drawSocialAvatarStain(ctx, events, seat, rect, now) {
  for (const event of activeSocialProps(events, now)) {
    if (event.targetSeat !== seat || event.value === 'hammer') continue
    const t = SOCIAL_PROP_TIMINGS[event.value], age = now - event.receivedAt
    if (age < t.hit) continue
    const grow = out(range(age, t.hit, t.hit + 170)), fade = 1 - range(age, t.end - 650, t.end)
    ctx.save(); ctx.globalAlpha *= fade * .67
    const x = rect.x + rect.w * .48, y = rect.y + rect.h * .45
    splat(ctx, x, y, rect.w * .37 * grow, event.value === 'tomato' ? '#e94629' : '#754528', 2)
    ctx.globalAlpha *= .8
    for (let i = 0; i < 3; i++) {
      const dripX = rect.x + rect.w * (.22 + i * .25), length = rect.h * (.1 + range(age, t.hit + i * 120, t.hit + 1100) * .65)
      line(ctx, [[dripX, y], [dripX, y + length]], event.value === 'tomato' ? '#c12e20' : '#4d2b1b', rect.w * .09)
      ellipse(ctx, dripX, y + length, rect.w * .045, rect.w * .06, event.value === 'tomato' ? '#ff7650' : '#ab7750')
    }
    if (event.value === 'tomato') for (const [dx, dy] of [[-.15, -.1], [.14, .12], [.02, -.19]])
      ellipse(ctx, x + rect.w * dx, y + rect.h * dy, rect.w * .025, rect.w * .06, '#ffd893', .7)
    ctx.restore()
  }
}

function flight(from, to, age, start, end, bounds) {
  const t = range(age, start, end), ease = smooth(t), distance = Math.hypot(to.x - from.x, to.y - from.y)
  const control = { x: (from.x + to.x) / 2, y: clamp(Math.min(from.y, to.y) - Math.min(100, distance * .3), 35, bounds.h - 55) }
  const p = point(from, control, to, ease)
  return { ...p, t, ease, control }
}
function trail(ctx, from, to, age, timing, bounds, color, end = timing.hit) {
  for (let i = 5; i >= 1; i--) {
    const pose = flight(from, to, age - i * 28, timing.launch, end, bounds)
    if (pose.t <= 0 || pose.t >= 1) continue
    ctx.save(); ctx.globalAlpha *= (6 - i) / 22
    ellipse(ctx, pose.x, pose.y, 9 + (5 - i) * 2, 4 + (5 - i), color, -.4); ctx.restore()
  }
}
function particles(ctx, target, age, hit, color, count = 16, gravity = 85) {
  const t = (age - hit) / 1000
  if (t < 0 || t > .95) return
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996, speed = 45 + (i % 5) * 16
    const x = target.x + Math.cos(a) * speed * t, y = target.y + Math.sin(a) * speed * t + gravity * t * t
    ctx.save(); ctx.globalAlpha *= (1 - t / .95) * .95; ctx.translate(x, y); ctx.rotate(a + t * 2)
    ellipse(ctx, 0, 0, 2.5 + i % 3, 4.5 + i % 4, color)
    ellipse(ctx, -1, -2, .9, 1.5, 'rgba(255,242,179,.65)'); ctx.restore()
  }
}
function shock(ctx, target, age, hit, color, radius = 44) {
  const t = range(age, hit, hit + 420)
  if (age < hit || t >= 1) return
  ctx.save(); ctx.globalAlpha *= (1 - t) * .8
  ellipse(ctx, target.x, target.y, 15 + out(t) * radius, 7 + out(t) * radius * .48)
  ctx.strokeStyle = color; ctx.lineWidth = (1 - t) * 3.5 + .5; ctx.stroke(); ctx.restore()
}
function caption(ctx, text, target, age, hit, bounds, color = '#ffe4a2') {
  const t = range(age, hit + 50, hit + 850)
  if (age < hit + 50 || t >= 1) return
  const below = target.y < 70, x = clamp(target.x, 40, bounds.w - 40)
  const y = clamp(target.y + (below ? 49 : -42) - out(t) * (below ? 0 : 11), 24, bounds.h - 95)
  ctx.save(); ctx.globalAlpha *= Math.min(1, t * 9) * (1 - range(t, .6, 1))
  ctx.translate(x, y); ctx.rotate(-.06); ctx.scale(1 + Math.sin(t * Math.PI) * .1, 1 + Math.sin(t * Math.PI) * .1)
  ctx.font = '900 20px "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.strokeStyle = '#3d2b21'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeText(text, 0, 0)
  ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore()
}
function tomatoAction(ctx, event, from, to, bounds, age) {
  const timing = SOCIAL_PROP_TIMINGS.tomato, scale = bounds.scale
  if (age < timing.hit) {
    const pose = flight(from, to, age, timing.launch, timing.hit, bounds)
    const wind = age < timing.launch ? Math.sin(range(age, 0, timing.launch) * Math.PI) * 12 : 0
    trail(ctx, from, to, age, timing, bounds, '#ff9868')
    ctx.save(); ctx.globalAlpha *= .18
    ellipse(ctx, pose.x, mix(from.y, to.y, pose.ease) + 25, 20 * scale * (1 - .3 * Math.sin(pose.t * Math.PI)), 5 * scale, '#090b09'); ctx.restore()
    drawSocialPropIcon(ctx, 'tomato', pose.x - wind, pose.y + wind * .4,
      scale * (.65 + Math.sin(pose.t * Math.PI) * .45 + pose.t * .12), pose.t * TAU * 1.3)
    if (pose.t > .15 && pose.t < .85) {
      ctx.save(); ctx.globalAlpha *= .5
      line(ctx, [[pose.x - 37, pose.y + 12], [pose.x - 22, pose.y + 5]], '#ffdbc0', 2)
      line(ctx, [[pose.x - 30, pose.y + 22], [pose.x - 17, pose.y + 16]], '#ffdbc0', 1.5); ctx.restore()
    }
  } else {
    const hitAge = age - timing.hit, fade = 1 - range(age, timing.end - 650, timing.end)
    shock(ctx, to, age, timing.hit, '#ffae78', 40 * scale)
    if (hitAge < 430) {
      ctx.save(); ctx.globalAlpha *= (1 - range(hitAge, 180, 430)) * .8
      const grow = .4 + out(clamp(hitAge / 140)) * .6
      splat(ctx, to.x, to.y, 31 * scale * grow, '#ec472c', 1)
      splat(ctx, to.x - 3, to.y - 3, 19 * scale * grow, '#ff7550', 3)
      ctx.restore()
    }
    particles(ctx, to, age, timing.hit, '#ec492b', 21, 90)
    for (let i = 0; i < 6; i++) {
      const t = clamp(hitAge / 1300), a = i * 2.399, speed = 30 + i * 8
      ctx.save(); ctx.globalAlpha *= fade * (1 - t) * .9
      ellipse(ctx, to.x + Math.cos(a) * speed * t, to.y + Math.sin(a) * speed * t + 70 * t * t,
        2 * scale, 4 * scale, '#ffe39e', a + t * 5); ctx.restore()
    }
    caption(ctx, '啪叽！', to, age, timing.hit, bounds, '#ffe0b7')
  }
}
function coffeePosition(to, bounds) {
  const dir = to.x > bounds.w / 2 ? -1 : 1
  return { x: clamp(to.x + dir * 62 * bounds.scale, 50, bounds.w - 50),
    y: clamp(to.y - 35 * bounds.scale, 54, bounds.h - 98), dir }
}
function coffeeAction(ctx, event, from, to, bounds, age) {
  const timing = SOCIAL_PROP_TIMINGS.coffee, targetCup = coffeePosition(to, bounds), scale = bounds.scale
  const pose = flight(from, targetCup, age, timing.launch, timing.arrive, bounds)
  const pouring = age >= timing.pour && age < timing.drain
  const tilt = smooth(range(age, timing.arrive, timing.pour + 150)) * (1 - smooth(range(age, timing.drain, timing.drain + 400)))
  const angle = targetCup.dir * -.98 * tilt, fill = 1 - range(age, timing.pour, timing.drain) * .9
  const fade = 1 - range(age, timing.drain + 300, timing.drain + 750)
  if (age < timing.arrive) trail(ctx, from, targetCup, age, timing, bounds, '#d1ac79', timing.arrive)
  if (pouring) {
    const lipOffset = rotate(-targetCup.dir * 23 * scale, -19 * scale, angle)
    const lip = { x: pose.x + lipOffset.x, y: pose.y + lipOffset.y }
    const control = { x: mix(lip.x, to.x, .55), y: Math.min(lip.y, to.y) - 18 * scale }
    const extent = out(range(age, timing.pour, timing.hit)), end = point(lip, control, to, extent)
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(lip.x, lip.y); ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
    ctx.strokeStyle = '#60301f'; ctx.lineWidth = (6 + Math.sin(age / 45) * 1.4) * scale; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(lip.x + 1, lip.y - 1); ctx.quadraticCurveTo(control.x, control.y - 1, end.x + 1, end.y - 1)
    ctx.strokeStyle = '#bc7e49'; ctx.lineWidth = 2 * scale; ctx.stroke()
    for (let i = 0; i < 8; i++) {
      const u = ((age - timing.pour) / 430 + i / 8) % 1
      if (u > extent) continue
      const p = point(lip, control, to, u)
      ellipse(ctx, p.x + Math.sin(age / 65 + i) * 3, p.y + i % 2 * 3, 2.7 * scale, 4 * scale, '#d59a60', -.6)
    }
    ctx.restore()
  }
  if (fade > 0) {
    ctx.save(); ctx.globalAlpha *= fade
    drawSocialPropIcon(ctx, 'coffee', pose.x, pose.y + Math.sin(age / 150) * 2,
      scale * (.68 + pose.t * .28), angle, fill)
    if (age < timing.pour) for (let i = 0; i < 2; i++) {
      const steam = (age / 900 + i * .5) % 1
      ctx.save(); ctx.globalAlpha *= Math.sin(steam * Math.PI) * .45
      ctx.beginPath(); ctx.moveTo(pose.x - 9 + i * 13, pose.y - 31)
      ctx.bezierCurveTo(pose.x - 18 + i * 13, pose.y - 40 - steam * 12, pose.x + i * 13, pose.y - 50 - steam * 12, pose.x - 9 + i * 13, pose.y - 60 - steam * 12)
      ctx.strokeStyle = '#eadbc3'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore()
    }
    ctx.restore()
  }
  if (age >= timing.hit) {
    particles(ctx, to, age, timing.hit, '#ad713c', 13, 85)
    shock(ctx, to, age, timing.hit, '#d9a567', 27 * scale)
    const drips = age - timing.hit, stainFade = 1 - range(age, timing.end - 600, timing.end)
    for (let i = 0; i < 5; i++) {
      const cycle = (drips / (730 + i * 57) + i * .17) % 1, distance = cycle * 43 * scale
      ctx.save(); ctx.globalAlpha *= stainFade * (1 - cycle) * .7
      ellipse(ctx, to.x + (i - 2) * 8 * scale, to.y + 15 + distance, 2.2 * scale, 4.3 * scale, '#a87543'); ctx.restore()
    }
    caption(ctx, '哎呀！', to, age, timing.hit, bounds)
  }
}
function hammerAngle(age) {
  const timing = SOCIAL_PROP_TIMINGS.hammer
  if (age < 890) return -1.04
  if (age < timing.hit) return mix(-1.04, 0, range(age, 890, timing.hit) ** 3)
  if (age < timing.hit + 65) return 0 // Hold the impact for two frames.
  if (age < 1360) return -.55 * out(range(age, timing.hit + 65, 1360))
  if (age < timing.secondHit) return mix(-.55, 0, range(age, 1360, timing.secondHit) ** 3)
  return -.18 * Math.sin(range(age, timing.secondHit, 1930) * Math.PI)
}
function hammerAction(ctx, event, from, to, bounds, age) {
  const timing = SOCIAL_PROP_TIMINGS.hammer, scale = bounds.scale * 1.06
  // The grip stays fixed. The heavy head follows an arc around that grip.
  const base = to.y < 65 ? 0 : Math.atan2(bounds.h * .45 - to.y, bounds.w / 2 - to.x) - Math.PI / 2
  const handle = rotate(0, 61 * scale, base), pivot = { x: to.x + handle.x, y: to.y + handle.y }
  const angle = base + hammerAngle(age), headOffset = rotate(0, -61 * scale, angle)
  const head = { x: pivot.x + headOffset.x, y: pivot.y + headOffset.y }
  const pose = flight(from, head, age, timing.launch, timing.arrive, bounds)
  const fade = 1 - range(age, 1790, 2160)
  if (age < timing.arrive) trail(ctx, from, head, age, timing, bounds, '#d3e4ef', timing.arrive)
  if (age > 890 && age < timing.hit) {
    ctx.save(); ctx.globalAlpha *= .55
    for (let i = 0; i < 3; i++) {
      const a = angle - .16 - i * .13, trailHead = rotate(0, -61 * scale, a)
      line(ctx, [[pivot.x + trailHead.x, pivot.y + trailHead.y], [pivot.x + trailHead.x * .83, pivot.y + trailHead.y * .83]], '#dae7ea', 3 - i * .6)
    }
    ctx.restore()
  }
  if (fade > 0) {
    ctx.save(); ctx.globalAlpha *= fade
    drawSocialPropIcon(ctx, 'hammer', pose.x, pose.y, scale * (.55 + pose.t * .45), angle)
    ctx.restore()
  }
  for (const hit of [timing.hit, timing.secondHit]) {
    const elapsed = age - hit
    if (elapsed < 0) continue
    shock(ctx, to, age, hit, '#ffda7c', 43 * scale)
    particles(ctx, { x: to.x, y: to.y + 7 }, age, hit, '#d9bb7b', 9, 30)
    if (elapsed < 230) {
      ctx.save(); ctx.globalAlpha *= 1 - elapsed / 230
      star(ctx, to.x, to.y, (29 + out(clamp(elapsed / 95)) * 13) * scale, '#fff0ad', age / 300)
      star(ctx, to.x, to.y, 14 * scale, '#fffaf0', -age / 400); ctx.restore()
    }
  }
  if (age >= timing.hit) {
    const fadeStars = 1 - range(age, timing.end - 600, timing.end)
    const center = { x: clamp(to.x, 32, bounds.w - 32), y: to.y < 65 ? to.y + 42 : to.y - 23 }
    // Orbit front and back stars at different heights to show depth.
    for (let i = 0; i < 3; i++) {
      const a = (age - timing.hit) / 250 + i / 3 * TAU, depth = Math.sin(a)
      ctx.save(); ctx.globalAlpha *= fadeStars * (.7 + depth * .2)
      star(ctx, center.x + Math.cos(a) * 31 * scale, center.y + Math.sin(a) * 9 * scale,
        (5.8 + depth * 1.4) * scale, '#ffd35c', a / 2); ctx.restore()
    }
    caption(ctx, '咚！', to, age, timing.secondHit, bounds)
  }
}

export function drawSocialPropEffects(ctx, events, anchor, width, height, now) {
  const bounds = { w: width, h: height, scale: clamp(width / 844, .82, 1.12) }
  for (const event of activeSocialProps(events, now)) {
    const fromCard = anchor(event.seat), toCard = anchor(event.targetSeat)
    if (!fromCard || !toCard) continue
    const source = socialAvatarBounds(fromCard), target = socialAvatarBounds(toCard)
    const from = { x: source.x + source.w / 2, y: source.y + source.h / 2 }
    const to = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
    ctx.save()
    const draw = { tomato: tomatoAction, coffee: coffeeAction, hammer: hammerAction }[event.value]
    draw(ctx, event, from, to, bounds, now - event.receivedAt)
    ctx.restore()
  }
}
