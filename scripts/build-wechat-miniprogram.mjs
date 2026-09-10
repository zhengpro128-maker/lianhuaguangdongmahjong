import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const root = resolve(import.meta.dirname, '..')
const sourceDir = resolve(root, 'src/wechat-miniprogram')
const outputDir = resolve(root, 'dist-wechat-miniprogram')
const env = loadEnv('wechat', root, '')
const webUrl = env.VITE_WECHAT_WEB_URL?.trim()
const appId = env.VITE_WECHAT_APP_ID?.trim()

if (!webUrl || !/^https:\/\//i.test(webUrl)) {
  throw new Error('VITE_WECHAT_WEB_URL must be a production HTTPS URL')
}
if (!appId || appId === 'touristappid' || !/^wx[0-9a-z]+$/i.test(appId)) {
  throw new Error('VITE_WECHAT_APP_ID must be a valid Mini Program AppID')
}

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })
cpSync(sourceDir, outputDir, {
  recursive: true,
  filter: (source) => !source.endsWith('.test.ts'),
})

function replace(fileName, replacements) {
  const file = resolve(outputDir, fileName)
  let content = readFileSync(file, 'utf8')
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(placeholder, value)
  }
  writeFileSync(file, content)
}

replace('pages/index/index.js', {
  '__WECHAT_WEB_URL__': JSON.stringify(webUrl),
})
replace('project.config.json', {
  '__WECHAT_APP_ID__': appId,
})

console.info(`WeChat Mini Program built: ${outputDir}`)
console.info(`Web view: ${webUrl}`)
