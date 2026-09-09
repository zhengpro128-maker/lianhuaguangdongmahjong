# 微信小游戏开发

## 当前阶段

仓库已提供微信小游戏运行时基础层：

- `wx.request` HTTP 客户端与 Bearer 登录态；
- `wx.connectSocket` 到现有 `SocketLike` 的适配器；
- 微信同步存储到现有远程会话存储的适配器；
- `wx.login` 登录交换；
- 房间邀请票据、分享卡片以及冷启动/热启动解析；
- 独立微信小游戏构建产物。

当前产物是迁移基础设施，还没有包含 Canvas 大厅和 Three.js 牌桌。浏览器版继续按原方式运行。

## 构建

复制示例环境变量并配置正式 HTTPS API：

```bash
cp .env.wechat.example .env.wechat.local
```

构建：

```bash
npm run build:wechat -- --mode wechat
```

使用微信开发者工具导入 `dist-wechat-game/`。取得正式 AppID 后，将生成产物中的
`project.config.json` 的 `appid` 改为正式值；不要提交 AppSecret。

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

## 后续开发

1. 增加 Canvas 大厅与分享/确认加入交互。
2. 将 Three.js 渲染器接到小游戏 Canvas/WebGL，并逐步迁移牌桌 HUD。
3. 将主题、图片和音频拆成分包或远程资源。
