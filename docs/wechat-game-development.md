# 微信标准小程序开发

## 实现方式

微信端默认构建为标准小程序，首页使用全屏 `web-view` 加载正式 Vue 3 + Three.js
游戏。小程序与网页版因此共用同一套页面、牌桌、规则、动画和联机代码，不再维护一套
视觉不一致的 Canvas UI。

旧版原生 Canvas 小游戏保留在 `src/wechat-game/`，只作为回退实现，不再是默认入口。

## 构建

复制示例环境变量并填写标准小程序 AppID：

```bash
cp .env.wechat.example .env.wechat.local
```

至少配置：

```text
VITE_WECHAT_WEB_URL=https://lianhuaguangdongmahjong.guoguo-labs.online/
VITE_WECHAT_APP_ID=wx0000000000000000
```

生成标准小程序：

```bash
pnpm build:wechat
```

产物位于 `dist-wechat-miniprogram/`。仓库根目录的本地 `project.config.json` 已将
`miniprogramRoot` 指向这个目录，因此微信开发者工具可以直接导入仓库根目录；也可单独
导入产物目录。

旧版原生 Canvas 小游戏仍可单独构建：

```bash
pnpm build:wechat-game
```

其产物位于 `dist-wechat-game/`，不会覆盖标准小程序。

## 微信后台配置

发布前必须在微信公众平台完成以下设置：

1. 使用标准“小程序”AppID，不能使用“小游戏”AppID。
2. 在“开发管理 → 开发设置 → 业务域名”添加
   `https://lianhuaguangdongmahjong.guoguo-labs.online`。
3. 业务域名必须部署微信要求的校验文件，并保持有效 HTTPS 证书。
4. 网页联机请求仍由网页自己的 `VITE_API_BASE` 和 WebSocket 配置负责；小程序主包不重复
   实现房间协议。

开发者工具中可临时关闭业务域名校验用于本地调试，但上传和真机发布前必须完成业务域名
登记。个人主体小程序若没有 `web-view`/业务域名能力，需使用具备该能力的主体，不能通过
代码绕过平台限制。

## 验收

1. 执行 `pnpm build`，确认正式网页本身可构建。
2. 执行 `pnpm build:wechat`，确认标准小程序产物完整。
3. 微信开发者工具编译类型应显示“小程序”，不再显示“小游戏模式”。
4. 模拟器应直接显示与正式网页一致的大厅和 Three.js 牌桌。
5. 真机覆盖登录、建房、加入、准备、开局、出牌、吃碰杠胡、结算、断线重进和横屏安全区。
