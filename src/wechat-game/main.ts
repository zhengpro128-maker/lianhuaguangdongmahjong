import { createWechatGameRuntime, type WechatGameRuntime } from './runtime'
import { mountWechatBootstrapScreen } from './bootstrapScreen'
import type { WxGameApi } from './wx'

declare const wx: WxGameApi
type WechatGameGlobal = typeof globalThis & {
  lianhuaGuangma?: WechatGameRuntime
  lianhuaBootstrap?: ReturnType<typeof mountWechatBootstrapScreen>
}

const apiBase = import.meta.env.VITE_WECHAT_API_BASE

if (!apiBase || !/^https:\/\//.test(apiBase)) {
  throw new Error('VITE_WECHAT_API_BASE must be a production HTTPS origin')
}

const gameGlobal = globalThis as WechatGameGlobal
gameGlobal.lianhuaGuangma = createWechatGameRuntime({
  wx,
  apiBase,
})

gameGlobal.lianhuaBootstrap = mountWechatBootstrapScreen({
  wx,
  runtime: gameGlobal.lianhuaGuangma,
  apiBase,
})

wx.onError?.((message) => {
  console.error('[莲花广麻] 微信运行错误', message)
})
wx.onUnhandledRejection?.((event) => {
  console.error('[莲花广麻] 未处理的异步错误', event.reason)
})

console.info('[莲花广麻] 微信小游戏运行时已启动')
