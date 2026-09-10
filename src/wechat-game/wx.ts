export interface WxRequestResult<T = unknown> {
  data: T
  statusCode: number
}

export interface WxSocketTask {
  onOpen(callback: () => void): void
  onMessage(callback: (event: { data: string | ArrayBuffer }) => void): void
  onClose(callback: () => void): void
  onError(callback: (error: unknown) => void): void
  send(options: { data: string; fail?: (error: unknown) => void }): void
  close(options?: { code?: number; reason?: string }): void
}

export interface WxLaunchOptions {
  query?: Record<string, string | undefined>
}

export interface WxCanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): CanvasRenderingContext2D | null
}

export interface WxTouchEvent {
  changedTouches?: Array<{
    clientX?: number
    clientY?: number
    pageX?: number
    pageY?: number
  }>
}

export interface WxGameApi {
  request<T = unknown>(options: {
    url: string
    method?: string
    data?: unknown
    header?: Record<string, string>
    success: (result: WxRequestResult<T>) => void
    fail: (error: unknown) => void
  }): void
  connectSocket(options: {
    url: string
    header?: Record<string, string>
  }): WxSocketTask
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void
  login(options: {
    success: (result: { code?: string }) => void
    fail: (error: unknown) => void
  }): void
  shareAppMessage(options: {
    title: string
    imageUrl?: string
    query?: string
  }): void
  getLaunchOptionsSync(): WxLaunchOptions
  onShow(callback: (options: WxLaunchOptions) => void): void
  createCanvas(): WxCanvasLike
  getSystemInfoSync(): {
    screenWidth: number
    screenHeight: number
    pixelRatio?: number
  }
  onTouchEnd(callback: (event: WxTouchEvent) => void): void
  showShareMenu?(options: {
    withShareTicket?: boolean
    menus?: string[]
  }): void
  onError?(callback: (message: string) => void): void
  onUnhandledRejection?(callback: (event: { reason?: unknown }) => void): void
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'errMsg' in error) {
    return String((error as { errMsg?: unknown }).errMsg || 'unknown error')
  }
  return 'unknown error'
}
