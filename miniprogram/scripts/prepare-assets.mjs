import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const miniRoot = fileURLToPath(new URL('../', import.meta.url))
const publicRoot = path.resolve(miniRoot, '../public')
const records = []
async function asset(source, target, transform) {
  const input = path.join(publicRoot, source)
  const output = path.join(miniRoot, 'assets', target)
  await mkdir(path.dirname(output), { recursive: true })
  if (transform) await transform(sharp(input)).toFile(output)
  else await copyFile(input, output)
  records.push({ source: `public/${source}`, target: `assets/${target}`,
    sourceSha256: createHash('sha256').update(await readFile(input)).digest('hex'),
    bytes: (await readFile(output)).length })
}
// All artwork comes from the web game. Avatars are rasterized and the lobby
// preview is compressed; tile face pixels are copied unchanged.
for (const file of (await readdir(path.join(publicRoot, 'tiles'))).filter(f => f.endsWith('.png')).sort()) {
  await asset(`tiles/${file}`, `tiles/${file}`)
}
for (const name of ['lotus', 'ah-lok', 'shisan', 'young-master']) {
  await asset(`avatars/${name}.svg`, `avatars/${name}.png`, img => img.resize(160, 160).png())
}
await asset('themes/lobby/v1/jade.png', 'themes/lobby/v1/jade.png', img => img.resize({ width: 960, withoutEnlargement: true }).png({ palette: true, quality: 90 }))
for (const name of ['audio', 'mute', 'manual']) await asset(`img/${name}.png`, `theme/${name}.png`)
for (const file of (await readdir(path.join(publicRoot, 'audio'))).filter(f => f.endsWith('.mp3')).sort()) {
  await asset(`audio/${file}`, `audio/${file}`)
}
await writeFile(path.join(miniRoot, 'assets/manifest.json'), `${JSON.stringify({ records }, null, 2)}\n`)
console.log(`Prepared ${records.length} original web assets (${(records.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(0)} KiB).`)
