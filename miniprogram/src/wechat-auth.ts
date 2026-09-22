import { API_BASE } from '../../src/game/online/api/httpClient'
export interface WechatIdentity { nickname: string; avatarUrl: string; displayId: string; sessionToken: string }
export function createWechatAuth(wxApi: any = (globalThis as any).wx) {
  let identity: WechatIdentity | null = null
  return {
    get identity() { return identity },
    async authorize(profile?: { nickName?: string; avatarUrl?: string }): Promise<WechatIdentity> {
      const details = profile || {}
      if (!details.nickName?.trim() || !details.avatarUrl?.startsWith('https://')) {
        throw new Error('微信未返回完整头像昵称，登录未完成。请通过原生微信登录按钮授权后重试')
      }
      if (!import.meta.env.VITE_API_BASE) throw new Error('请先配置小游戏服务器地址 VITE_API_BASE')
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('微信登录超时，请检查网络后重试')), 15000)
        wxApi.login({ timeout: 12000,
          success: (r: any) => { clearTimeout(timer); r.code ? resolve(r.code) : reject(new Error('微信未返回登录凭证')) },
          fail: (error: any) => { clearTimeout(timer); reject(new Error(`微信登录失败：${error?.errMsg || '未知错误'}`)) } })
      })
      const data = await new Promise<any>((resolve, reject) => wxApi.request({
        url: `${API_BASE}/api/minigame/login`, method: 'POST', timeout: 15000,
        data: { code, profile: { nickname: (details.nickName || '微信玩家').slice(0, 20), avatarUrl: details.avatarUrl || '' } },
        success: (r: any) => r.statusCode === 200 && r.data?.sessionToken && r.data?.account?.id && r.data?.account?.displayName && r.data?.account?.avatarUrl ? resolve(r.data)
          : reject(new Error(`服务器登录失败（HTTP ${r.statusCode}）：${r.data?.detail?.code || '响应格式异常'}`)),
        fail: (error: any) => reject(new Error(`登录网络请求失败：${error?.errMsg || '请检查网络与 request 合法域名'}`)) }))
      let hash = 2166136261
      for (const char of String(data.account.id || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
      identity = { displayId: (hash >>> 0).toString(16).toUpperCase().padStart(8, '0'), nickname: data.account.displayName, avatarUrl: data.account.avatarUrl, sessionToken: data.sessionToken }
      try { wxApi.setStorageSync('wuhan-mini.profile', { nickName: identity.nickname, avatarUrl: identity.avatarUrl }) } catch { /* memory remains available */ }
      return identity
    },
  }
}
