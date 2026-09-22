/** Use the browser's original recordings through the Mini Game audio API. */
export function createMiniAudio(wxApi, initiallyEnabled = true) {
  let enabled = initiallyEnabled
  let hidden = false
  let disposed = false
  const active = new Set()

  function playSoundAndWait(name, volume = 0.8) {
    if (!enabled || hidden || disposed || !wxApi.createInnerAudioContext) return Promise.resolve()
    // Never let a missing recording or interrupted audio block the opening timeline.
    return new Promise((resolve) => {
      let audio
      let timeout
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        active.delete(finish)
        try { audio?.destroy() } catch { /* already released by the host */ }
        resolve()
      }
      try {
        // Overlapping voices/effects are bounded even during rapid autoplay.
        if (active.size >= 6) active.values().next().value()
        audio = wxApi.createInnerAudioContext()
        active.add(finish)
        audio.src = `assets/audio/${name.split('/').pop()}`
        audio.volume = Math.min(1, Math.max(0, volume))
        audio.onEnded(finish)
        audio.onError(finish)
        audio.onStop?.(finish)
        timeout = setTimeout(finish, 6000)
        audio.play()
      } catch { finish() }
    })
  }

  function stop() { for (const finish of [...active]) finish() }
  return {
    playSound(name, volume, onFinish) {
      return playSoundAndWait(name, volume).then(() => onFinish?.())
    },
    playSoundAndWait,
    setEnabled(value) { enabled = Boolean(value); if (!enabled) stop() },
    setHidden(value) { hidden = Boolean(value); if (hidden) stop() },
    dispose() { disposed = true; stop() },
  }
}
