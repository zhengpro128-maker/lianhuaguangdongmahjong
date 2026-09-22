import { API_BASE } from '../../src/game/online/api/httpClient'
export interface WechatIdentity { nickname: string; avatarUrl: string; sessionToken: string }
export function createWechatAuth(wxApi: any = (globalThis as any).wx) {
  let identity: WechatIdentity | null = null
  return {
    get identity() { return identity },
    async authorize(profile?: { nickName?: string; avatarUrl?: string }): Promise<WechatIdentity> {
      if (!profile) {
        try { profile = wxApi.getStorageSync('wuhan-mini.profile') || {} } catch { profile = {} }
      }
      const details = profile || {}
      if (!import.meta.env.VITE_API_BASE) throw new Error('请先配置小游戏服务器地址 VITE_API_BASE')
      const code = await new Promise<string>((resolve, reject) => wxApi.login({
        success: (r: any) => r.code ? resolve(r.code) : reject(new Error('微信登录失败')), fail: reject }))
      const data = await new Promise<any>((resolve, reject) => wxApi.request({
        url: `${API_BASE}/api/minigame/login`, method: 'POST', timeout: 15000,
        data: { code, profile: { nickname: (details.nickName || '微信玩家').slice(0, 20), avatarUrl: details.avatarUrl || '' } },
        success: (r: any) => r.statusCode === 200 && r.data?.sessionToken ? resolve(r.data)
          : reject(new Error(r.data?.detail?.code || '微信登录失败')), fail: reject }))
      identity = { nickname: data.account.displayName, avatarUrl: data.account.avatarUrl, sessionToken: data.sessionToken }
      try { wxApi.setStorageSync('wuhan-mini.profile', { nickName: identity.nickname, avatarUrl: identity.avatarUrl }) } catch { /* memory remains available */ }
      return identity
    },
  }
}
