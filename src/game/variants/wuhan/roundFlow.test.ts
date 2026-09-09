import { describe, expect, it } from 'vitest'
import { canWuhanDraw, createWuhanRoundWall, declareWuhanRedKong, drawWuhanHead, drawWuhanTail } from './roundFlow'

describe('武汉晃晃牌墙流程', () => {
  it('keeps a 120 tile wall and stops drawing at eight tiles', () => {
    const round = createWuhanRoundWall([1, 1], () => 0.25)
    expect(round.wall).toHaveLength(120)
    while (round.wall.length - round.headDrawn > 8) expect(drawWuhanHead(round)).not.toBeNull()
    expect(canWuhanDraw(round)).toBe(false)
    expect(drawWuhanTail(round)).toBeNull()
  })
  it('removes exactly one red dragon for a red kong', () => {
    const hand = ['red', 'red', 'm1'] as any[]
    expect(declareWuhanRedKong(hand)).toBe(true)
    expect(hand).toEqual(['red', 'm1'])
  })
})
