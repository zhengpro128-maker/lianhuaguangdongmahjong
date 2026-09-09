import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  if (!env.VITE_WECHAT_API_BASE) {
    throw new Error('VITE_WECHAT_API_BASE is required for the WeChat build')
  }

  return {
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
            appid: 'touristappid',
            compileType: 'game',
            projectname: 'lianhua-guangma-wechat',
            setting: { es6: true, minified: true, urlCheck: true },
          }, null, 2),
        })
      },
    }],
  }
})
