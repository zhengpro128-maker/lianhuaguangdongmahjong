/** One shared layout for Canvas HUD and WebGL. Tiles never render beneath the rails. */
export function miniTableLayout(width, height, safe = {}, menuButton = null) {
  const left = Math.max(12, (safe.left || 0) + 6)
  const right = Math.max(12, (safe.right || 0) + 6)
  const top = Math.max(8, safe.top || 0)
  const rail = width < 740 ? 96 : 110
  const headerBottom = Math.max(top + 54, (menuButton?.bottom || 0) + 10)
  const boardWidth = Math.max(1, width - left - right - 2 * (rail + 8))
  const handTileWidth = Math.max(18, Math.min(54, (boardWidth - 35) / 14))
  const footer = Math.max(100, handTileWidth * 1.37 + 55) + (safe.bottom || 0)
  const board = { x: left + rail + 8, y: headerBottom,
    w: boardWidth, h: Math.max(1, height - headerBottom - footer) }
  return { left, right, top, rail, board, footer }
}
