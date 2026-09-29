# 微信小游戏牌桌互动

## 使用

- 牌桌左上角「聊天」或自己的头像：发送文字、6 条快捷短语和 6 种表情。
- 点击其他玩家头像：选择扔番茄、倒咖啡、砸锤子；道具从发送者飞向目标座位并播放命中效果。
- 「消息」查看本次会话最近 30 条消息，支持翻页；「屏蔽互动」隐藏气泡和动画，仍可查看消息记录。
- 文字最多 60 个 Unicode 字符；每位玩家每 2 秒最多发送一次。单机可体验，联机由服务端确认后同桌广播；断线时不可发送。
- 离开房间清空消息；消息不持久化，重连不补发历史动画。互动不影响牌局规则、分数或动作请求。

## 素材

首版使用系统 Emoji 和 Canvas 飞行、旋转、飞溅效果，无需外网下载素材。图案在不同手机系统上可能不同。`src/game/shared/roomSocial.ts` 的 `SOCIAL_PROPS[].asset` 留空，后续可指定随包 PNG 素材（同时加入小游戏资源准备脚本）。目前没有专门的道具音效。

## 联机协议与发布

客户端发送 `{ type: 'room_social', category, value, targetSeat? }`。短语、表情、道具使用稳定 ID；文本使用原文。服务器生成消息 ID，从已认证 WebSocket 连接确定发送座位，校验消息类型、长度、目标座位和频率，只向本房间广播 `{ kind: 'room_social', id, seat, category, value, targetSeat? }`。服务端座位是绝对座位，小游戏在收发时转换为本地座位。

需要一起发布 master 的小游戏包与独立 backend 仓库的 `app/game/social.py`、`app/game/room.py`。本次只实现现有 WebSocket 小游戏通道，vibehub 的 P2P 联机层由原同步清单保留。未执行线上部署或微信发布，真机表现仍需微信开发者工具/体验版验证。

## 验证

- `pnpm test`：1214 通过，2 跳过。
- `pnpm test:mini`：75 通过；`pnpm typecheck`、`pnpm typecheck:mini` 通过。
- `pnpm build:mini`：主包 1.68 MiB。
- `node miniprogram/scripts/social-smoke.mjs`：浏览器原生输入替身、短语、三种定向道具、消息记录、667×320 紧凑屏幕和表情面板通过；截图在忽略的 `docs/evidence/miniprogram-social/`。
- 后端 `tests/test_social.py`：23 项测试，含两个真实 WebSocket 客户端的房间广播。
- 后端全量：557 通过，4 失败（两项点杠计分、一项开发登录身份复用、一项整场分数汇总）。四项均用 Git HEAD 的原始房间模块在内存中加载后复现，属于原有问题，未在本次聊天功能中修改。
