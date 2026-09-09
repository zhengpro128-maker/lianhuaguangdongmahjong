import { describe, expect, it } from 'vitest'
import { resolveWuhanIntercept, wuhanInterceptOrder } from './intercept'
describe('武汉晃晃截胡', () => {
  it('uses counter-clockwise order and only keeps the first accepted win', async () => {
    expect(wuhanInterceptOrder(3)).toEqual([0, 1, 2])
    const asked: number[] = []
    await expect(resolveWuhanIntercept(3, seat => seat !== 0, seat => { asked.push(seat); return seat === 1 })).resolves.toBe(1)
    expect(asked).toEqual([1])
  })
})
