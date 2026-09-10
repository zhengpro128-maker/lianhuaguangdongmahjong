# 微信小游戏开发

## 当前阶段

仓库已提供可联机对局的微信小游戏版本：

- `wx.request` HTTP 客户端与 Bearer 登录态；
- `wx.connectSocket` 到现有 `SocketLike` 的适配器；
- 微信同步存储到现有远程会话存储的适配器；
- `wx.login` 登录交换；
- 房间邀请票据、分享卡片以及冷启动/热启动解析；
- 原生 Canvas 大厅（昵称、东风/半庄、两套规则、建房/房间码/邀请加入、准备、分享、开局、离开）；
- 原生 Canvas 牌桌（四席、牌墙、手牌、牌河、副露、五主题、服务端权威快照）；
- 出牌、吃、碰、明/暗/加/风杠、胡、过、结算和下一局完整操作；
- 独立微信小游戏构建产物，构建时只收集 34 张牌面，避免复制 33MB 浏览器资源。

小游戏没有浏览器 DOM，Vue HUD 与 Three.js 的 DOM 事件层不能直接运行，因此小游戏使用
`nativeTable.ts` 将同一套牌面、主题色、四席布局和服务端协议映射到原生 Canvas。浏览器版
继续按原方式运行，两端共用同一后端房间和规则真源。

## 构建

复制示例环境变量，配置正式 HTTPS API 和小游戏 AppID：

```bash
cp .env.wechat.example .env.wechat.local
```

构建：

```bash
pnpm build:wechat
```

使用微信开发者工具导入 `dist-wechat-game/`。生成产物中的 `project.config.json`
会自动写入 `VITE_WECHAT_APP_ID`；不要手工修改生成文件，也不要提交 AppSecret。

启动后会自动恢复微信登录和未结束房间。大厅支持分享邀请与手工房间码；进入牌局后，
点击手牌一次选中、再次点击确认打出。服务端仍是唯一状态真源，小游戏不在本地计算牌局结果。

## 后端接口契约

微信运行时目前约定以下新增接口：

```text
POST /api/auth/wechat
body: { "code": "wx.login 返回的一次性 code" }
response: { "playerId": "wechat-...", "accessToken": "...", "expiresAt": 1234567890 }

POST /api/rooms/{roomId}/invites
Authorization: Bearer <accessToken>
response: { "roomId": "ABC123", "inviteTicket": "...", "expiresAt": 1234567890 }

POST /api/rooms/{roomId}/join-by-invite
Authorization: Bearer <accessToken>
body: { "inviteTicket": "...", "nickname": "..." }
response: {
  "roomId": "ABC123", "seat": 1, "nickname": "...",
  "playerId": "...", "rejoinCode": "...", "mode": "east",
  "rulesetId": "lotus-classic"
}
```

`inviteTicket` 是短期 HMAC 签名凭证，不复用任一玩家的 `rejoinCode`。票据绑定
房间码，默认 15 分钟过期，可供多位好友使用。只有房间内已占座玩家能生成票据；
加入时校验签名、房间、有效期、容量和房间状态。同一玩家重复打开卡片会幂等恢复
原座位。

WebSocket 握手优先从 `Authorization` 请求头验证微信访问令牌；座位恢复仍使用服务端签发的
`rejoinCode`。

运行时启动后会调用 `wx.login`，访问令牌与到期时间保存在微信本地存储中。有效令牌会直接
恢复；临近到期会重新登录；受保护接口返回 401 时只自动刷新并重试一次。微信的原始 OpenID
和 `session_key` 始终留在服务端，不写入小游戏存储。

小游戏运行时已提供 `createRoom` / `joinRoom` / `getCurrentRoom` /
`leaveCurrentRoom` / `setReady` / `startCurrentRoom` / `shareRoom` /
`joinPendingInvite` / `connectCurrentRoom` API。建房或受邀加入后会统一保存座位与
`rejoinCode`；`connectCurrentRoom` 使用 `wss://`、Bearer 令牌和重进码建立实时对局连接。

## 发布前真机验收

1. 在微信开发者工具导入 `dist-wechat-game/`，确认请求与 Socket 合法域名均已配置。
2. 用四个真实微信账号覆盖冷启动邀请、热启动邀请、断线重进和完整东风/半庄对局。
3. 覆盖 iPhone/Android 常见横屏安全区与 1x/2x/3x DPR；当前自动化只验证协议与 Canvas 交互。
4. 若后续要求逐像素复刻浏览器 WebGL 光照、粒子与角色动画，需要单独移植 Three.js
   渲染管线并规划资源分包；这不影响当前原生 Canvas 版本完成规则联机对局。
