const { GAME_WEB_URL } = require('../../config')

Page({
  data: {
    gameUrl: GAME_WEB_URL,
  },

  onLoad() {
    if (!/^https:\/\//.test(GAME_WEB_URL)) {
      console.warn('非 HTTPS 地址仅可用于开发者调试预览；真机需打开“不校验合法域名”调试：', GAME_WEB_URL)
    }
  },

  onWebViewLoad() {
    console.info('游戏 H5 已加载')
  },

  onWebViewError(event) {
    console.error('游戏 H5 加载失败，请检查业务域名和 HTTPS 配置：', event.detail)
    wx.showToast({ title: '游戏加载失败', icon: 'none' })
  },
})
