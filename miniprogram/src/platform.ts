/** Browser-independent services used by the shared rules. This never creates a canvas. */
export function installMiniGamePlatform(wxApi: any = (globalThis as any).wx) {
  const root = globalThis as any
  const windowObject = root.window ?? (root.window = {})
  for (const name of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) {
    if (!windowObject[name]) windowObject[name] = root[name].bind(root)
  }
  if (!root.performance) root.performance = { now: () => Date.now() }
  if (!windowObject.performance) windowObject.performance = root.performance
  // The shared Wuhan turn/settlement code uses Array.at; older iOS game JS
  // engines lack it even though they support the ES2020 bundle syntax.
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value(this: unknown[], index: number) {
      const offset = Math.trunc(Number(index) || 0)
      return this[offset < 0 ? this.length + offset : offset]
    },
  })
  if (!root.localStorage) {
    const memory = new Map<string, string>()
    root.localStorage = {
      getItem(key: string) {
        try {
          const value = wxApi?.getStorageSync(`browser.${key}`)
          if (value !== '' && value !== undefined && value !== null) return String(value)
        } catch { /* Some devices disable persistent storage. */ }
        return memory.get(key) ?? null
      },
      setItem(key: string, value: unknown) {
        memory.set(key, String(value))
        try { wxApi?.setStorageSync(`browser.${key}`, String(value)) } catch { /* Keep the session copy. */ }
      },
      removeItem(key: string) {
        memory.delete(key)
        try { wxApi?.removeStorageSync(`browser.${key}`) } catch { /* Keep the session copy. */ }
      },
    }
  }
  if (!windowObject.localStorage) windowObject.localStorage = root.localStorage
  return { window: windowObject, storage: root.localStorage }
}
