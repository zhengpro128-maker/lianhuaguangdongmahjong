import { createWechatGameRuntime, type WechatGameRuntime } from './runtime'
import type { WxGameApi } from './wx'

declare const wx: WxGameApi
declare const GameGlobal: { lianhuaGuangma?: WechatGameRuntime }

const apiBase = import.meta.env.VITE_WECHAT_API_BASE

if (!apiBase || !/^https:\/\//.test(apiBase)) {
  throw new Error('VITE_WECHAT_API_BASE must be a production HTTPS origin')
}

GameGlobal.lianhuaGuangma = createWechatGameRuntime({
  wx,
  apiBase,
})

console.info('[莲花广麻] 微信小游戏运行时已启动')
