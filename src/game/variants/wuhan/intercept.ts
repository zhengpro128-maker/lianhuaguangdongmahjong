/** 一炮多响关闭时，逆时针距离最小者拥有唯一胡牌权。 */
export function wuhanInterceptOrder(from: number, seats = 4): number[] {
  return Array.from({ length: seats - 1 }, (_, index) => (from + index + 1) % seats)
}

/**
 * 依次询问候选者；拒绝或超时会让出机会，首个确认者立即截胡。
 * 回调可用于真人弹窗或 AI 决策，规则层不依赖 UI。
 */
export async function resolveWuhanIntercept(
  from: number,
  canWin: (seat: number) => boolean,
  ask: (seat: number) => boolean | Promise<boolean>,
  seats = 4,
): Promise<number | null> {
  for (const seat of wuhanInterceptOrder(from, seats)) {
    if (canWin(seat) && await ask(seat)) return seat
  }
  return null
}
