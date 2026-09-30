const MAX_CUE_LAG_MS = 350
const MAX_HANDLED_CUES = 256
const RECORD_TTL_MS = 10000
const FEEDBACK_GROUP_MS = 100
const HAPTIC_STRENGTH = { light: 1, medium: 2 }

/** Play each cue once on the render clock; no timers survive a room or app hide. */
export function createSocialFeedback({ getCues, playSound, vibrateShort }) {
  let session = null, hidden = false, disposed = false, ignoreReceivedBefore = -Infinity, lastHapticAt = -Infinity
  const handled = new Map()
  const forget = () => { handled.clear(); session = null; lastHapticAt = -Infinity }

  function update(state, { now = Date.now(), enabled = true, muted = false, visible = true } = {}) {
    if (disposed || !state) return
    if (state.phase === 'lobby') { forget(); return }
    const currentSession = `${state.socialSession ?? ''}:${state.gameMode ?? ''}:${state.online?.roomId ?? ''}`
    if (currentSession !== session) { forget(); session = currentSession }
    for (const [key, expires] of handled) if (expires <= now) handled.delete(key)

    // The opening timeline owns dice/deal audio; social cues still expire on time.
    const allowed = enabled && !muted && visible && !hidden && !['opening', 'dealing'].includes(state.phase)
    // Online snapshots and social events are already rotated to the local viewer.
    const localSeat = state.user?.seat ?? state.localSeat ?? 0
    const scheduled = new Map(), sounds = []
    let haptic = null
    for (const event of state.socialEvents || []) {
      if (!event?.id || !Number.isFinite(event.receivedAt) || event.receivedAt <= ignoreReceivedBefore) continue
      const cues = getCues(event)
      for (let index = 0; index < cues.length; index++) {
        const cue = cues[index]
        if (!Number.isFinite(cue.at)) continue
        const key = `${event.id}:${index}`
        scheduled.set(key, { event, cue, at: event.receivedAt + cue.at })
      }
    }
    for (const [key, { event, cue, at }] of scheduled) {
      const lag = now - at
      if (lag < 0 || handled.has(key)) continue
      handled.set(key, now + RECORD_TTL_MS)
      while (handled.size > MAX_HANDLED_CUES) handled.delete(handled.keys().next().value)
      // Muted/late cues are consumed, so toggling sound cannot replay them.
      if (!allowed || lag > MAX_CUE_LAG_MS) continue
      if (cue.sound) sounds.push({ cue, at })
      if (cue.haptic && event.targetSeat === localSeat) {
        if (!haptic || HAPTIC_STRENGTH[cue.haptic] > HAPTIC_STRENGTH[haptic]) haptic = cue.haptic
      }
    }
    // Keep every sound, with headroom for cues scheduled close together even
    // when the broadcasts land on adjacent render frames.
    for (const { cue, at } of sounds) {
      const voices = [...scheduled.values()].filter(other => other.cue.sound && Math.abs(other.at - at) <= FEEDBACK_GROUP_MS).length
      try {
        const result = playSound?.(cue.sound, (cue.volume ?? .8) / Math.sqrt(voices))
        result?.catch?.(() => {})
      } catch { /* an unsupported sound host must not interrupt a frame */ }
    }
    if (haptic && now - lastHapticAt >= FEEDBACK_GROUP_MS) {
      lastHapticAt = now
      try { vibrateShort?.({ type: haptic, fail: () => {} }) }
      catch { /* simulator and older clients may not support haptics */ }
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
