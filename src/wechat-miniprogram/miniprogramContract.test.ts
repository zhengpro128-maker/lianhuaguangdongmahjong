import { describe, expect, it } from 'vitest'

async function source(relativePath: string): Promise<string> {
  // @ts-expect-error node:fs is available to Vitest, while the browser tsconfig omits Node types.
  const { readFileSync } = await import('node:fs')
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8') as string
}

describe('standard WeChat Mini Program contract', () => {
  it('uses a landscape web-view page instead of the legacy Mini Game canvas', async () => {
    const [appConfig, pageConfig, template] = await Promise.all([
      source('./app.json'),
      source('./pages/index/index.json'),
      source('./pages/index/index.wxml'),
    ])

    expect(JSON.parse(appConfig).pages).toEqual(['pages/index/index'])
    expect(JSON.parse(pageConfig)).toEqual(expect.objectContaining({
      navigationStyle: 'custom',
      pageOrientation: 'landscape',
      disableScroll: true,
    }))
    expect(template).toContain('<web-view')
    expect(template).toContain('binderror="handleError"')
    expect(template).not.toContain('<canvas')
  })

  it('builds as a Mini Program and injects the configured HTTPS web URL', async () => {
    const [projectConfig, pageScript] = await Promise.all([
      source('./project.config.json'),
      source('./pages/index/index.js'),
    ])

    expect(JSON.parse(projectConfig)).toEqual(expect.objectContaining({
      compileType: 'miniprogram',
      miniprogramRoot: './',
    }))
    expect(pageScript).toContain('const WEB_URL = __WECHAT_WEB_URL__')
    expect(pageScript).toContain('retry()')
    expect(pageScript).toContain('onShareAppMessage()')
  })
})
