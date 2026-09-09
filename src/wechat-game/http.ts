import { errorMessage, type WxGameApi } from './wx'

export interface WechatRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

export class WechatRemoteApiError extends Error {
  code: string
  status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'WechatRemoteApiError'
    this.code = code
    this.status = status
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function responseErrorCode(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail
    if (detail && typeof detail === 'object' && 'code' in detail) {
      return String((detail as { code?: unknown }).code || `HTTP_${status}`)
    }
  }
  return `HTTP_${status}`
}

export function createWechatHttpClient(options: {
  wx: Pick<WxGameApi, 'request'>
  baseUrl: string
  getAccessToken?: () => string | null
}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)

  function request<T>(path: string, init: WechatRequestOptions = {}): Promise<T> {
    const accessToken = options.getAccessToken?.()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...init.headers,
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`

    return new Promise<T>((resolve, reject) => {
      options.wx.request<T>({
        url: `${baseUrl}${path}`,
        method: init.method ?? 'GET',
        data: init.body,
        header: headers,
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) {
            resolve(result.data)
            return
          }
          reject(new WechatRemoteApiError(responseErrorCode(result.data, result.statusCode), result.statusCode))
        },
        fail(error) {
          reject(new Error(`NETWORK_ERROR: ${errorMessage(error)}`))
        },
      })
    })
  }

  return { request }
}

export type WechatHttpClient = ReturnType<typeof createWechatHttpClient>
