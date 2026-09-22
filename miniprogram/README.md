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

本实现为本地人机版本；没有伪造的房间、联机或大模型入口。未接入微信登录、联网房间、云存档和进程结束后的断局恢复。

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
pnpm test:mini:e2e  # 同一份小游戏 UMD 包的浏览器宿主测试
pnpm preview:mini  # http://127.0.0.1:4176
```

浏览器宿主只模拟微信 API 以检查画面与事件，不能代替微信真机验收。预览脚本与测试、源文件不会进入上传包；`build:mini` 检查主包的 4 MiB 体积预算。

应在 Android / iOS 真机继续检查长局性能、音频静音开关、横屏刘海安全区、切后台恢复、微信胶囊遮挡，以及低端机 WebGL 兼容性。还原度需结合这些实测和逐屏对照验收，不能仅凭构建成功认定达到 90%。
