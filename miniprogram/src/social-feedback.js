const MAX_CUE_LAG_MS = 350
const MAX_HANDLED_CUES = 256
const RECORD_TTL_MS = 10000

/** Play each cue once on the render clock; no timers survive a room or app hide. */
export function createSocialFeedback({ getCues, playSound, vibrateShort }) {
  let session = null, hidden = false, disposed = false, ignoreReceivedBefore = -Infinity
  const handled = new Map()
  const forget = () => { handled.clear(); session = null }

  function update(state, { now = Date.now(), enabled = true, muted = false, visible = true } = {}) {
    if (disposed || !state) return
    if (state.phase === 'lobby') { forget(); return }
    const currentSession = `${state.socialSession ?? ''}:${state.gameMode ?? ''}:${state.online?.roomId ?? ''}`
    if (currentSession !== session) { handled.clear(); session = currentSession }
    for (const [key, expires] of handled) if (expires <= now) handled.delete(key)

    // The opening timeline owns dice/deal audio; social cues still expire on time.
    const allowed = enabled && !muted && visible && !hidden && !['opening', 'dealing'].includes(state.phase)
    // Online snapshots and social events are already rotated to the local viewer.
    const localSeat = state.user?.seat ?? state.localSeat ?? 0
    for (const event of state.socialEvents || []) {
      if (!event?.id || !Number.isFinite(event.receivedAt) || event.receivedAt <= ignoreReceivedBefore) continue
      const cues = getCues(event)
      for (let index = 0; index < cues.length; index++) {
        const cue = cues[index]
        if (!Number.isFinite(cue.at)) continue
        const lag = now - (event.receivedAt + cue.at)
        if (lag < 0) continue
        const key = `${event.id}:${index}`
        if (handled.has(key)) continue
        handled.set(key, now + RECORD_TTL_MS)
        while (handled.size > MAX_HANDLED_CUES) handled.delete(handled.keys().next().value)
        // Muted/late cues are consumed, so toggling sound cannot replay them.
        if (!allowed || lag > MAX_CUE_LAG_MS) continue
        try {
          const result = cue.sound ? playSound?.(cue.sound, cue.volume) : undefined
          result?.catch?.(() => {})
        } catch { /* an unsupported sound host must not interrupt a frame */ }
        if (cue.haptic && event.targetSeat === localSeat) {
          try { vibrateShort?.({ type: cue.haptic, fail: () => {} }) }
          catch { /* simulator and older clients may not support haptics */ }
        }
      }
    }
  }

  return {
    update,
    setHidden(value, now = Date.now()) {
      hidden = Boolean(value)
      // Returning to the game must not replay feedback for hidden interactions.
      if (!hidden) ignoreReceivedBefore = now
    },
    reset: forget,
    dispose() { disposed = true; forget() },
  }
}
