/** HUD anchors only. The 3D table always fills the screen, independently of these controls. */
export function miniTableLayout(width, height, safe = {}, menuButton = null) {
  const left = Math.max(10, (safe.left || 0) + 5)
  const right = Math.max(10, (safe.right || 0) + 5)
  const top = Math.max(5, safe.top || 0)
  const bottom = safe.bottom || 0
  const compact = width < 740
  const toolbarWidth = compact ? 90 : 110
  const toolbar = { x: width - right - toolbarWidth, y: Math.max(top + 40, (menuButton?.bottom || 0) + 8), w: toolbarWidth }
  const indicator = { x: width - right - (compact ? 72 : 110), y: toolbar.y + 36, w: compact ? 72 : 110, h: compact ? 42 : 58 }
  const sideW = compact ? 58 : 96, sideH = compact ? 56 : 44
  const sideY = compact ? indicator.y + indicator.h + 8 : Math.max(toolbar.y + 102, height * .43 - 20)
  const seats = [
    { x: left, y: height - bottom - 60, w: 104, h: 44 },
    { x: width - right - sideW, y: sideY, w: sideW, h: sideH },
    { x: Math.min(width * .67, (menuButton?.left ?? width - right) - 106), y: top, w: 96, h: 36 },
    { x: left, y: sideY, w: sideW, h: sideH },
  ]
  const handLeft = left + seats[0].w + 12
  const handRight = width - right - 83
  return { left, right, top, toolbar, indicator, seats, hand: { x: handLeft, w: Math.max(1, handRight - handLeft) } }
}
