import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function createPreviewServer() {
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
  const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.png':'image/png', '.mp3':'audio/mpeg', '.json':'application/json' }
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return }
      const relative = pathname === '/' ? 'preview/index.html' : pathname.slice(1)
      const file = path.resolve(root, relative)
      if (!file.startsWith(root + path.sep) || !['preview/', 'js/', 'assets/'].some(prefix => relative.startsWith(prefix))) {
        response.writeHead(403).end(); return
      }
      const data = await readFile(file)
      response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      response.end(data)
    } catch { response.writeHead(404).end() }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MINI_PREVIEW_PORT || 4176)
  createPreviewServer().listen(port, '127.0.0.1', () => console.log(`Mini Game preview: http://127.0.0.1:${port}`))
}
