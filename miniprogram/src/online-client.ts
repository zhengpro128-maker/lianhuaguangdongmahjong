/** Adapt the existing browser REST/socket protocol to native WeChat APIs. */
export function installWechatNetwork(wxApi: any, getToken: () => string) {
  if (!wxApi.request || !wxApi.connectSocket) return
  const root = globalThis as any
  root.fetch = (url: string, init: any = {}) => new Promise((resolve, reject) => {
    wxApi.request({ url, method: init.method || 'GET', data: init.body,
      header: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${getToken()}` },
      timeout: 15000,
      success: (r: any) => resolve({ ok: r.statusCode >= 200 && r.statusCode < 300,
        status: r.statusCode, json: async () => r.data }), fail: reject })
  })
  root.WebSocket = class {
    readyState = 0
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null
    task: any
    timer: ReturnType<typeof setTimeout> | null = null
    finish(event: any) {
      if (this.readyState === 3) return
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = null; this.readyState = 3; this.onclose?.(event)
    }
    constructor(url: string) {
      this.task = wxApi.connectSocket({ url, success() {} })
      this.timer = setTimeout(() => { this.task.close({}); this.finish({ reason: '连接超时' }) }, 15000)
      this.task.onOpen((e: any) => { if (this.readyState !== 0) return; if (this.timer !== null) clearTimeout(this.timer); this.timer = null; this.readyState = 1; this.onopen?.(e) })
      this.task.onMessage((e: any) => this.onmessage?.(e))
      this.task.onError((e: any) => { this.onerror?.(e); this.task.close({}); this.finish(e) })
      this.task.onClose((e: any) => this.finish(e))
    }
    send(data: string) { if (this.readyState === 1) this.task.send({ data, fail: (e: any) => { this.onerror?.(e); this.task.close({}); this.finish(e) } }) }
    close() { if (this.readyState === 3) return; this.readyState = 2; this.task.close({}); this.finish({}) }
  }
}
