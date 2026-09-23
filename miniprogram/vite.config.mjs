import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const root = path.resolve(import.meta.dirname, '..')
  const env = loadEnv(mode, root)
  const wechatEnv = loadEnv('wechat', root)
  return {
    // 构建从仓库根目录执行时，不能把浏览器版 public/ 复制进小游戏 js/。
    publicDir: false,
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || env.VITE_API_BASE || wechatEnv.VITE_WECHAT_API_BASE || ''),
      'process.env.NODE_ENV': JSON.stringify('production'),
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
      'import.meta.env.BASE_URL': JSON.stringify('./'),
    },
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.resolve(import.meta.dirname, 'src/index.js'),
        // UMD 同时支持微信小游戏的 CommonJS require 和调试器的浏览器预览。
        formats: ['umd'],
        name: 'WuhanMiniProgram',
        fileName: () => 'game.bundle.js',
      },
      outDir: path.resolve(import.meta.dirname, 'js'),
      target: 'es2020',
      minify: true,
    },
  }
})
