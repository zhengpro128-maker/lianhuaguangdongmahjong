import { defineConfig, loadEnv } from 'vite'
// 前端 tsconfig 刻意不引入整套 Node 类型；构建配置仍运行于 Node。
// @ts-ignore node:fs 由 Vite 构建进程提供（有无可选 Node 类型均可构建）
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path 由 Vite 构建进程提供（有无可选 Node 类型均可构建）
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  if (!env.VITE_WECHAT_API_BASE) {
    throw new Error('VITE_WECHAT_API_BASE is required for the WeChat build')
  }
  if (!env.VITE_WECHAT_APP_ID || env.VITE_WECHAT_APP_ID === 'touristappid') {
    throw new Error('VITE_WECHAT_APP_ID is required for the WeChat build')
  }

  return {
    // 只复制小游戏真正使用的公共资源，避免把浏览器主题/头像全集塞进主包。
    publicDir: false,
    build: {
      outDir: 'dist-wechat-game',
      emptyOutDir: true,
      target: 'es2020',
      minify: true,
      rollupOptions: {
        input: 'src/wechat-game/main.ts',
        output: {
          format: 'iife',
          entryFileNames: 'game.js',
        },
      },
    },
    plugins: [{
      name: 'wechat-game-manifest',
      generateBundle() {
        // 微信小游戏主包只需要牌面；浏览器 public/ 约 33MB，整体复制会超过主包限制。
        for (const fileName of readdirSync(resolve('public/tiles'))) {
          if (!fileName.endsWith('.png')) continue
          this.emitFile({
            type: 'asset',
            fileName: `tiles/${fileName}`,
            source: readFileSync(resolve('public/tiles', fileName)),
          })
        }
        for (const fileName of readdirSync(resolve('public/audio'))) {
          if (!/\.(?:mp3|ogg)$/.test(fileName)) continue
          this.emitFile({
            type: 'asset',
            fileName: `audio/${fileName}`,
            source: readFileSync(resolve('public/audio', fileName)),
          })
        }
        this.emitFile({
          type: 'asset',
          fileName: 'game.json',
          source: JSON.stringify({
            deviceOrientation: 'landscape',
            showStatusBar: false,
            networkTimeout: { request: 10000, connectSocket: 10000 },
          }, null, 2),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'project.config.json',
          source: JSON.stringify({
            appid: env.VITE_WECHAT_APP_ID,
            compileType: 'game',
            projectname: 'lianhua-guangma-wechat',
            setting: { es6: true, minified: true, urlCheck: true },
          }, null, 2),
        })
      },
    }],
  }
})
