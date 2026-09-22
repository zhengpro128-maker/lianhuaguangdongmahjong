const { bootMiniGame } = require('./js/game.bundle')
try {
  bootMiniGame(wx)
} catch (error) {
  console.error('小游戏初始化失败', error)
  wx.showModal({ title: '暂时无法加载牌桌',
    content: '请更新微信后重新进入。' + String(error && error.message || error), showCancel: false })
}
