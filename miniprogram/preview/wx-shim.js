// Test-only browser host for the exact bundle consumed by WeChat game.js.
// Excluded by project.config.json; never shipped in the Mini Game package.
(() => {
  // Optional integration-test clock acceleration; never bundled for WeChat.
  const params = new URLSearchParams(location.search)
  if (params.has('test') && params.has('fast')) {
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay = 0, ...args) => schedule(callback, delay <= 2000 ? delay / 20 : delay, ...args)
  }
  let screenCanvas
  const handlers = new Map()
  const emit = (name, event) => { for (const handler of handlers.get(name) || []) handler(event) }
  const api = {
    createCanvas() {
      const canvas = document.createElement('canvas')
      if (!screenCanvas) {
        screenCanvas = canvas
        document.body.append(canvas)
        const pointer = event => ({ changedTouches: [{ clientX: event.clientX, clientY: event.clientY, identifier: event.pointerId }] })
        canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); emit('TouchStart', pointer(event)) })
        canvas.addEventListener('pointerup', event => emit('TouchEnd', pointer(event)))
        canvas.addEventListener('pointercancel', event => emit('TouchCancel', pointer(event)))
      }
      return canvas
    },
    createImage: () => new Image(),
    getWindowInfo: () => ({ windowWidth: innerWidth, windowHeight: innerHeight, pixelRatio: devicePixelRatio,
      safeArea: { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight } }),
    getSystemInfoSync() { return this.getWindowInfo() },
    getStorageSync(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return undefined } },
    setStorageSync: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    removeStorageSync: key => localStorage.removeItem(key),
    setKeepScreenOn() {},
    showModal: ({ title, content }) => console.error(title, content),
    createInnerAudioContext() {
      const audio = new Audio()
      const listeners = {}
      const test = new URLSearchParams(location.search).has('test')
      return {
        set src(value) { audio.src = value },
        set volume(value) { audio.volume = value },
        onEnded(handler) { listeners.end = handler; audio.onended = handler },
        onError(handler) { listeners.error = handler; audio.onerror = handler },
        onStop(handler) { listeners.stop = handler },
        play() { if (test) Promise.resolve().then(() => listeners.end?.()); else audio.play().catch(() => listeners.error?.()) },
        destroy() { audio.pause(); audio.removeAttribute('src') },
      }
    },
  }
  for (const name of ['TouchStart','TouchEnd','TouchCancel','Show','Hide','WindowResize']) {
    api[`on${name}`] = handler => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler) }
    api[`off${name}`] = handler => handlers.get(name)?.delete(handler)
  }
  window.addEventListener('resize', () => emit('WindowResize', { size: { windowWidth: innerWidth, windowHeight: innerHeight } }))
  document.addEventListener('visibilitychange', () => emit(document.hidden ? 'Hide' : 'Show'))
  window.wx = api
  window.miniHost = { emit }
})()
