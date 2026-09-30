# 微信小游戏牌桌互动

微信小游戏的单机和 WebSocket 联机牌桌均支持文字、短语、表情与三种道具。两种模式使用同一套 Canvas 动画、头像受击反馈和音效。

## 使用

- 牌桌左上角「聊天」或自己的头像：发送文字、6 条快捷短语和 6 种表情。
- 点击其他玩家头像：选择扔番茄、倒咖啡、砸锤子；道具从发送者飞向目标座位并播放命中效果。
- 「消息」查看本次会话最近 30 条消息，支持翻页；「屏蔽互动」隐藏气泡和动画，仍可查看消息记录。
- 文字最多 60 个 Unicode 字符；每位玩家每 2 秒最多发送一次。单机可体验，联机由服务端确认后同桌广播；断线时不可发送。
- 离开房间清空消息；消息不持久化，重连不补发历史动画。互动不影响牌局规则、分数或动作请求。

## 动效与素材

三种道具在 `miniprogram/src/social-effects.js` 中用原生 Canvas 路径绘制，菜单与动画共用图形，不依赖手机系统的道具 Emoji 或外网素材。

- 番茄：起手、旋转抛物线飞行、运动拖尾、命中爆浆和种子飞溅；头像受击晃动，表面留下逐渐滴落和消退的番茄汁。持续 2.9 秒。
- 咖啡：杯子飞至目标附近、倾倒、连续液流和水滴、杯内液面下降、回正消失；头像受击后轻颤，咖啡污渍继续滴落再淡出。持续 3.6 秒。
- 锤子：飞入、绕握把抡起、挥下、命中停顿、回弹和第二次砸击；头像压缩回弹，冲击波、尘点与眩晕星星随后消退。持续 3.05 秒。

起手和命中配有随包的原创 PCM WAV 音效，由 `miniprogram/scripts/social-audio.mjs` 确定性生成，四段音效合计约 71 KiB。被击中的本机玩家在支持 `wx.vibrateShort` 的设备上获得短震动。关闭声音或屏蔽互动时不播放声音和震动；切到后台、恢复、离开房间不会补播旧音效。

同屏最多绘制最近四个有效道具；受击幅度有上限，结束后头像恢复原位。互动仍不影响手牌、分数和规则。

## 联机协议与发布

客户端发送 `{ type: 'room_social', category, value, targetSeat? }`。短语、表情、道具使用稳定 ID；文本使用原文。服务器生成消息 ID，从已认证 WebSocket 连接确定发送座位，校验消息类型、长度、目标座位和频率，只向本房间广播 `{ kind: 'room_social', id, seat, category, value, targetSeat? }`。服务端座位是绝对座位，小游戏在收发时转换为本地座位。

首次启用聊天协议需要一起发布 master 的小游戏包与独立 backend 仓库的 `app/game/social.py`、`app/game/room.py`。本次动效增强沿用相同协议，已经部署聊天后端的服务器无需更新，只需重新编译/发布小游戏包。单机动画无需服务器。本功能使用现有 WebSocket 小游戏通道，vibehub 的 P2P 联机层由原同步清单保留。未执行线上部署或微信发布，真机表现仍需微信开发者工具/体验版验证。

联机开局后，点击其他玩家头像发送道具。服务端收到消息后向本房间所有已连接玩家广播，包括发送者；四个客户端分别把发送座位和目标座位转成自己的视角，再播放相同的动效。只有被击中的玩家手机震动，其余玩家看到动作并听到音效。服务器若尚未部署聊天功能提交 `c3cb940`，需要先拉取后端 `main` 并重启服务；只更新小游戏包无法让旧后端广播互动消息。

## 联机验证

- `pnpm exec vitest run --config miniprogram/vitest.config.mjs miniprogram/src/online.test.ts`：4 通过，验证微信网络适配、服务器广播接收、发送/目标座位转换、去重、断线禁发和离房清理。
- `node miniprogram/scripts/social-online-smoke.mjs`：四个实际小游戏构建的浏览器宿主，通过微信网络 API 替身接入同一测试房间，真实触摸菜单发道具，再经 socket 消息进入生产解码器和桥接器。四种视角的目标头像像素均有变化，每人收到对应音效，只有目标本机震动；三类聊天、重复广播、断线和离房也通过。截图与报告在忽略的 `docs/evidence/miniprogram-social-online/`。此测试的房间传输为内存替身，真实后端广播由下一项独立验证。
- 后端 `.venv/bin/python -m pytest tests/test_social.py -q`：23 通过。真实 WebSocket 测试连接四个客户端，验证三种道具、文字、短语和表情由服务端广播给全部四人，发送者和消息 ID 由服务端确定，保留真实两秒频率限制。

## 动效增强验证

- `pnpm test:mini`：91 通过；`pnpm typecheck:mini` 通过。
- `pnpm build:mini`：主包 1.77 MiB（96 个文件），低于 4 MiB 限制。
- `node miniprogram/scripts/social-effects-preview.mjs`：实际小游戏构建在 844×390 和 667×320 上验证三种道具的飞行、命中、余效、四座位目标反馈和动画结束恢复。截图、可播放 APNG 与报告保存在忽略的 `docs/evidence/miniprogram-social-v2/`；`index.html` 同时展示六幅循环动画。
- `node miniprogram/scripts/social-smoke.mjs`：聊天、文字、三种道具发送、消息记录、紧凑布局与表情菜单回归通过。

## 首版协议验证

- `pnpm test`：1214 通过，2 跳过。
- `pnpm test:mini`：75 通过；`pnpm typecheck`、`pnpm typecheck:mini` 通过。
- `pnpm build:mini`：主包 1.68 MiB。
- `node miniprogram/scripts/social-smoke.mjs`：浏览器原生输入替身、短语、三种定向道具、消息记录、667×320 紧凑屏幕和表情面板通过；截图在忽略的 `docs/evidence/miniprogram-social/`。
- 后端 `tests/test_social.py`：23 项测试，含两个真实 WebSocket 客户端的房间广播。
- 后端全量：557 通过，4 失败（两项点杠计分、一项开发登录身份复用、一项整场分数汇总）。四项均用 Git HEAD 的原始房间模块在内存中加载后复现，属于原有问题，未在本次聊天功能中修改。
