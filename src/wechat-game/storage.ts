import type { StorageLike } from '../game/online/session/remoteSessionStore'
import type { WxGameApi } from './wx'

export function createWechatStorage(wx: Pick<WxGameApi, 'getStorageSync' | 'setStorageSync' | 'removeStorageSync'>): StorageLike {
  return {
    getItem(key: string): string | null {
      const value = wx.getStorageSync(key)
      if (value === undefined || value === null || value === '') return null
      return typeof value === 'string' ? value : JSON.stringify(value)
    },
    setItem(key: string, value: string): void {
      wx.setStorageSync(key, value)
    },
    removeItem(key: string): void {
      wx.removeStorageSync(key)
    },
  }
}
