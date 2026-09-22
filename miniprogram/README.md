# 武汉晃晃 · 微信小游戏

原生横屏小游戏：只保留 **武汉晃晃** 和 **默认墨玉** 牌桌。直接运行 WebGL / Canvas，不依赖 WebView 或网页地址。浏览器版本的其他玩法和主题不出现在小游戏大厅。

## 开发与导入

在仓库根目录执行：

```sh
pnpm install
pnpm build:mini
```

在微信开发者工具选择「小游戏 → 导入项目」，目录选本文件所在的 `miniprogram/`（同时包含 `game.js`、`game.json` 和 `project.config.json`）。不要导入仓库根目录旧的小程序配置。

`game.js` 加载构建后的 `js/game.bundle.js`。修改 `src/` 或共享浏览器代码后重新运行 `pnpm build:mini`，再在开发者工具编译。`project.private.config.json` 仅保存本机调试设置，不入库。

## 玩法与操作

- 大厅选择东风场或半庄场，与三个本地 AI 对局。
- 规则直接使用浏览器端 `src/game/variants/wuhan/useWuhanGame.ts`：120 张牌、掷骰翻癞、摸打、吃碰杠胡与过牌、红中/癞子单张杠、抢杠、8 张留底、计分封顶、荒庄与续局。
- 点击手牌选中，再次点击出牌；也可从手牌向上滑动出牌。红中/癞子沿用浏览器引擎的单杠操作，不会作为普通弃牌进入牌河。
- 吃碰杠胡按钮由引擎当前合法动作生成；吃牌有多组时展示具体牌组。
- 显示听牌提示、癞子、庄家、当前出牌者、剩余牌数、四家分数与结算明细。
- 托管可切换；音效和场次选择保存在微信本地存储。离开当前对局需在游戏内确认。

## 微信登录与联机

大厅新增「微信登录」使用大厅预先创建的 `wx.createUserInfoButton` 原生按钮，首次点击授权后取头像昵称，再调用 `wx.login` 和服务端身份校验。两步都成功才进入已登录状态。取消授权、缺少头像昵称或服务器失败均提示失败，不自动回退为默认资料；建房/加入/重进也不绕过此入口。已授权用户是否再次出现微信授权弹窗由微信控制，不能承诺每次都弹窗。登录 token 仅保存在内存中，重启后重新授权登录；房间重进凭证仍保存在微信本地存储。真实资料返回须用该 AppID 的手机体验版验证。


部署顺序：

1. 在后端服务器设置 `WECHAT_APP_ID`（与 project.config.json 一致）、`WECHAT_APP_SECRET` 和至少 32 字符的独立随机 `WECHAT_SESSION_SECRET`，然后部署后端。密钥不得写入小游戏或提交到仓库。登录接口为 `POST /api/minigame/login`，通过微信 `jscode2session` 换取可信身份；`session_key` 不返回客户端。
2. 后端需要公开 HTTPS，代理支持 `/ws/room/*` 的 WSS Upgrade。沿用现有常驻 Python 房间服务，不使用云函数承载长连接。
3. 在小游戏管理后台配置 request 合法域名和 socket 合法域名，并按平台要求配置用户信息隐私声明。头像域名也需满足微信图片加载的域名要求；开发者工具关闭域名校验不代表真机可用。
4. 在 master 构建：`VITE_API_BASE=https://你的后端域名 pnpm build:mini`。不配置地址时联机入口显示明确提示，不会请求示例服务器。随后在开发者工具重新编译。此构建使用 master 的 WebSocket 源码；vibehub 仅同步小游戏成品，不在 P2P 分支重建小游戏。
5. 四台设备分别登录，房主创建房间，其他玩家输入 6 位房间号加入；全员准备后由房主开局。切后台/断网恢复会沿用重连机制，彻底退出后使用「重进联机房间」。

验收应包含四人出牌/吃碰杠胡、结算继续、房主退出、断线恢复和头像昵称显示。自动化里的微信 code 交换使用桩服务，不能替代真实 AppID 的扫码登录验收。

## 复用来源

| 小游戏部分 | 浏览器来源 |
| --- | --- |
| 规则、回合、AI、结算 | `src/game/variants/wuhan/` 及其共享模块，直接导入 |
| 墨玉桌、材质、灯光 | `staticTableScene.ts` / `tableTheme.ts` |
| 牌墙、牌河、副露与三家手牌 | `tableTilePresenter.ts` / `tileInstanceRenderer.ts` |
| 牌面 | `public/tiles/*.png` 原文件 |
| 四家头像 | `public/avatars/*.svg` 转 PNG |
| 大厅预览 | `public/themes/lobby/v1/jade.png` 压缩 |
| 报牌与操作音效 | `public/audio/*.mp3` 原文件 |

`assets/manifest.json` 记录来源、原文件 SHA-256 和打包尺寸。资源全部来自现有浏览器版，没有新增名称衍生视觉。运行时使用微信 `createImage` / `createCanvas` / `createInnerAudioContext` 加载包内文件。

## 验证

```sh
pnpm test:mini      # 桥接规则、资源生命周期与触摸交互测试
pnpm test          # 浏览器共享逻辑回归测试
pnpm typecheck
pnpm typecheck:mini
pnpm test:mini:e2e  # 同一份小游戏 UMD 包的浏览器宿主测试
pnpm preview:mini  # http://127.0.0.1:4176
```

浏览器宿主只模拟微信 API 以检查画面与事件，不能代替微信真机验收。预览脚本与测试、源文件不会进入上传包；`build:mini` 检查主包的 4 MiB 体积预算。

应在 Android / iOS 真机继续检查长局性能、音频静音开关、横屏刘海安全区、切后台恢复、微信胶囊遮挡，以及低端机 WebGL 兼容性。还原度需结合这些实测和逐屏对照验收，不能仅凭构建成功认定达到 90%。
