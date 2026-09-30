import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Original procedural recordings: no downloaded samples or runtime DSP.
// A fixed seed makes the PCM files reproducible on every package build.
const RATE = 22050
const TAU = Math.PI * 2
function noise(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return (state >>> 0) / 2147483648 - 1
  }
}
function smoothNoise(random, cutoff) {
  let previous = 0
  const weight = 1 - Math.exp(-TAU * cutoff / RATE)
  return () => (previous += weight * (random() - previous))
}
const attack = (t, seconds) => Math.min(1, Math.max(0, t / seconds))
const decay = (t, seconds) => t >= 0 ? Math.exp(-t / seconds) : 0

function wave(duration, sample) {
  const samples = new Float64Array(Math.round(RATE * duration))
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const time = i / RATE
    const fade = attack(time, .002) * attack(duration - time, .018)
    samples[i] = sample(time) * fade
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  // Leave headroom for overlapping table sounds and the host's mixer.
  const gain = peak > 0 ? .69 / peak : 0
  const pcm = Buffer.alloc(44 + samples.length * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4)
  pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16)
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22)
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28)
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34)
  pcm.write('data', 36); pcm.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(samples[i] * gain * 32767), 44 + i * 2)
  return pcm
}

function throwSound() {
  const random = noise(0x534f4354), low = smoothNoise(random, 2600)
  const duration = .21
  return wave(duration, t => {
    const arc = Math.pow(Math.sin(Math.PI * t / duration), 1.4)
    const whoosh = low() * .9 + random() * .09
    const pitch = Math.sin(TAU * (820 * t - 1550 * t * t)) * .1
    return arc * (whoosh + pitch)
  })
}
function tomatoSound() {
  const random = noise(0x534f4350), wet = smoothNoise(random, 1600)
  return wave(.38, t => {
    const thump = Math.sin(TAU * (118 * t - 75 * t * t)) * decay(t, .036) * .72
    const splat = wet() * decay(t, .11) * attack(t, .003)
    let drops = 0
    for (let i = 0; i < 7; i++) {
      const age = t - (.015 + i * .027)
      if (age >= 0) drops += Math.sin(TAU * (460 + i * 151) * age) * decay(age, .012) * (.12 - i * .011)
    }
    return thump + splat * 1.4 + drops
  })
}
function coffeeSound() {
  const random = noise(0x534f4343), liquid = smoothNoise(random, 1250)
  return wave(.69, t => {
    const pour = attack(t, .07) * attack(.65 - t, .17)
    const flow = liquid() * .35 * pour * (.7 + .3 * Math.sin(TAU * 15 * t))
    let bubbles = 0
    for (let i = 0; i < 17; i++) {
      const age = t - (.012 + i * .034 + Math.sin(i * 4.1) * .009)
      if (age >= 0) bubbles += Math.sin(TAU * (820 + (i % 5) * 167) * age - 2200 * age * age)
        * decay(age, .012 + (i % 3) * .004) * (.12 + (i % 4) * .016)
    }
    return flow + bubbles
  })
}
function hammerSound() {
  const random = noise(0x534f4348), impact = smoothNoise(random, 1900)
  return wave(.36, t => {
    const hit = impact() * decay(t, .025) * .9
    const wood = Math.sin(TAU * 148 * t) * decay(t, .035) * .62
    const ring = (Math.sin(TAU * 742 * t) + Math.sin(TAU * 1193 * t) * .45
      + Math.sin(TAU * 2111 * t) * .18) * decay(t, .075) * .2
    return hit + wood + ring
  })
}

export function createSocialAudioAssets() {
  return [
    { file: 'social_throw.wav', pcm: throwSound() },
    { file: 'social_tomato.wav', pcm: tomatoSound() },
    { file: 'social_coffee.wav', pcm: coffeeSound() },
    { file: 'social_hammer.wav', pcm: hammerSound() },
  ]
}

export async function writeSocialAudioAssets(directory) {
  await mkdir(directory, { recursive: true })
  const assets = createSocialAudioAssets()
  for (const asset of assets) await writeFile(path.join(directory, asset.file), asset.pcm)
  return assets
}
