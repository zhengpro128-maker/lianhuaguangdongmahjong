import { describe, expect, it, vi } from 'vitest'
import { createWechatNativeTable } from './nativeTable'
import type { ServerSnapshot } from '../game/online/protocol/dto'

function harness() {
  const context = new Proxy({
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'middle',
  } as any, {
    get(target, key) {
      if (!(key in target)) target[key] = vi.fn()
      return target[key]
    },
  })
  const send = vi.fn()
  const table = createWechatNativeTable({
    wx: { createImage: () => ({ src: '', onload: null, onerror: null }) } as any,
    context, width: 667, height: 375, dpr: 2, send,
  })
  return { table, send }
}

function snapshot(phase: ServerSnapshot['phase'] = 'discard'): ServerSnapshot {
  return {
    kind: 'state_snapshot', roomId: 'ABC123', mode: 'east', rulesetId: 'lotus-classic',
    phase, round: 1, dealer: 0, honba: 0, wallCount: 70, headDrawn: 0,
    currentPlayer: 0, seat: 0, result: null, announcement: null, matchFinished: false,
    lastDiscard: null, winPresentation: null, winningPlayerIndex: -1,
    players: [0, 1, 2, 3].map((seat) => ({
      name: `P${seat}`, avatar: '', score: 1000, seat,
      hand: seat === 0 ? ['m1', 'm2', 'm3'] : [null, null, null],
      discards: [], melds: [], redCount: 0, drawnTileIndex: seat === 0 ? 2 : -1,
    })),
  }
}

describe('wechat native table', () => {
  it('requires select then confirm before discarding during turn request', () => {
    const { table, send } = harness()
    table.receive(snapshot())
    table.receiveMessage({
      kind: 'turn_request',
      ctx: { hand: ['m1', 'm2', 'm3'], melds: [], exposedMelds: 0, kongBloom: false, skipDraw: false, afterKong: false },
    })
    table.handleTouch({ changedTouches: [{ clientX: 277, clientY: 330 }] })
    expect(send).not.toHaveBeenCalled()
    table.handleTouch({ changedTouches: [{ clientX: 277, clientY: 330 }] })
    expect(send).toHaveBeenCalledWith({ type: 'discard', handIndex: 0 })
  })

  it('does not invent a hu action when the server did not allow it', () => {
    const { table, send } = harness()
    table.receive(snapshot())
    table.handleTouch({ changedTouches: [{ clientX: 333, clientY: 240 }] })
    expect(send).not.toHaveBeenCalledWith({ type: 'hu' })
  })
})
