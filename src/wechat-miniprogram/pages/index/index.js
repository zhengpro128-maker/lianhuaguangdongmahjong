const WEB_URL = __WECHAT_WEB_URL__

function withReloadToken(url) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}wechat_reload=${Date.now()}`
}

Page({
  data: {
    webUrl: WEB_URL,
    failed: false,
    errorText: '',
  },

  handleLoad() {
    if (this.data.failed) this.setData({ failed: false, errorText: '' })
  },

  handleError(event) {
    const detail = event?.detail?.errMsg || '网页加载失败'
    this.setData({ failed: true, errorText: detail })
  },

  retry() {
    this.setData({
      failed: false,
      errorText: '',
      webUrl: withReloadToken(WEB_URL),
    })
  },

  onShareAppMessage() {
    return {
      title: '莲花广麻 · 四人在线麻将',
      path: '/pages/index/index',
    }
  },
})
