import { readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = []
async function collect(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) await collect(name)
    else files.push(name)
  }
}
await collect('assets')
files.push('game.js', 'game.json', 'js/game.bundle.js')
let bytes = 0
for (const file of files) bytes += (await stat(path.join(root, file))).size
const bundle = await readFile(path.join(root, 'js/game.bundle.js'), 'utf8')
if (/require\(["'](?:vue|three|\.\.\/)/.test(bundle)) throw new Error('Unbundled runtime dependency')
if (bytes > 4 * 1024 * 1024) throw new Error(`Main package exceeds 4 MiB: ${bytes} bytes`)
console.log(`Mini Game main package: ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${files.length} files (4 MiB budget).`)
