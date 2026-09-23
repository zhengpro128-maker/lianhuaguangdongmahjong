import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ThreeTable, ensureCanvasEvents, miniTableProps } from '../src/three-table.js'
import { createTableTilePresenter } from '../../src/components/table/three/tableTilePresenter'

function player(seat = 0) {
  return { seat, hand: ['m1', 'm1', 'p2'], discards: [], melds: [], drawnTileIndex: -1, redCount: 0 }
}

function tableForUpdate() {
  const table = Object.create(ThreeTable.prototype)
  Object.assign(table, {
    camera: new THREE.PerspectiveCamera(), system: { windowWidth: 844, windowHeight: 390 },
    disposed: false, loaded: true, props: miniTableProps(), signature: '', machineSignature: '',
    browserTable: { updateMachineTexture: vi.fn() },
    tableTiles: { rebuild: vi.fn() }, clearDynamicScene: vi.fn(),
  })
  return table
}

describe('Mini Game shared table lifecycle', () => {
  it('matches the browser Wuhan table adapter while keeping the raw HUD indicator', () => {
    const state = { players: [player()], user: { seat: 2 }, dealer: 3,
      winningPlayerIndex: 1, result: { horses: ['p1'] }, flipStack: 6,
      flipTile: 'm8', jokerTiles: ['m9'], jokerAsLaizi: false, wallTotal: 136 }
    const props = miniTableProps(state)
    expect(props).toMatchObject({ localSeat: 2, dealerIndex: 3, winnerIndex: 1,
      horses: ['p1'], flipTile: 'm8', jokerTiles: ['m9'], jokerAsLaizi: true,
      wallTotal: 120, flipStackRemoved: false, themeName: 'jade' })
    expect(props.flipStack).toBeUndefined()
    expect(state.flipStack).toBe(6)
  })

  it('renders exactly the remaining Wuhan wall without a stranded flip-stack tile', () => {
    const props = miniTableProps({ players: Array.from({ length: 4 }, (_, seat) => ({ ...player(seat), hand: [] })),
      wall: Array(67).fill('m1'), wallHeadDrawn: 53, flipStack: 0, wallBreakIndex: 0 })
    const scene = new THREE.Scene()
    scene.userData.tileImages = new Map()
    const add = vi.fn()
    const presenter = createTableTilePresenter({ props, scene, dynamicGroups: [],
      ownDynamic: item => item, clearDynamicScene: vi.fn(), makeFaceTile: vi.fn(), tableScene: {} as any,
      tileInstances: { add, begin: vi.fn(), finish: vi.fn(), canReuse: () => false } as any,
      tileLayerZ: -1, playAreaOffsetZ: -1.65, tileGapOffset: .75, pointGapOffset: 1.02,
      wallDealOriginY: 1.1, addWinEffect: vi.fn(), addWinningDisplayTile: vi.fn() })
    presenter.rebuild()
    expect(add).toHaveBeenCalledTimes(67)
    expect(add.mock.calls.every(call => call[2] === null)).toBe(true)
  })

  it('adapts a native canvas without DOM events and can unsubscribe on dispose', () => {
    const canvas: any = {}
    expect(ensureCanvasEvents(canvas)).toBe(true)
    const lost = vi.fn(event => event.preventDefault())
    canvas.addEventListener('webglcontextlost', lost)
    const event = { type: 'webglcontextlost', defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    expect(canvas.dispatchEvent(event)).toBe(false)
    expect(lost).toHaveBeenCalledTimes(1)
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.dispatchEvent(event)
    expect(lost).toHaveBeenCalledTimes(1)
    const existing = canvas.addEventListener
    expect(ensureCanvasEvents(canvas)).toBe(false)
    expect(canvas.addEventListener).toBe(existing)
  })

  it('does not rebuild scene geometry for HUD selection or countdown updates', () => {
    const table = tableForUpdate()
    const state = { players: [player()], wall: ['p9', 's2'], wallCount: 2, currentPlayer: 0 }
    table.update(state)
    const sharedProps = table.props
    for (let tick = 0; tick < 100; tick++) table.update({ ...state, selectedTileIndex: tick % 3, countdown: tick })
    expect(table.tableTiles.rebuild).toHaveBeenCalledTimes(1)
    expect(table.browserTable.updateMachineTexture).toHaveBeenCalledTimes(1)
    expect(table.props).toBe(sharedProps)
  })

  it('updates the physical wall after both head and replacement draws', () => {
    const table = tableForUpdate()
    const state = { players: [player()], wall: ['p9', 's2', 'm3'], wallHeadDrawn: 52, wallCount: 3 }
    table.update(state)
    table.update({ ...state, wall: ['s2', 'm3'], wallHeadDrawn: 53, wallCount: 2 })
    table.update({ ...state, wall: ['s2'], wallHeadDrawn: 53, wallCount: 1 })
    expect(table.tableTiles.rebuild).toHaveBeenCalledTimes(3)
    expect(table.props.wall).toEqual(['s2'])
    expect(table.props.wallHeadDrawn).toBe(53)
  })

  it('detects an in-place discard mutation and clears stale round metadata', () => {
    const table = tableForUpdate()
    const state = { players: [player()], flipStack: 7, wallBreakIndex: 18 }
    table.update(state)
    state.players[0].discards.push('m1')
    state.players[0].hand.pop()
    table.update(state)
    expect(table.tableTiles.rebuild).toHaveBeenCalledTimes(2)
    table.update({ players: [player()] })
    expect(table.props.flipStack).toBeUndefined()
    expect(table.props.wallBreakIndex).toBeUndefined()
    expect(table.props.wallTotal).toBe(120)
  })

  it('releases transient GPU resources and removes objects when a round rebuilds', () => {
    const table = Object.create(ThreeTable.prototype)
    const scene = new THREE.Scene()
    const transient = new THREE.Group()
    scene.add(transient)
    const dispose = vi.fn()
    table.dynamicGroups = [transient]
    const retainedArray = table.dynamicGroups
    table.dynamicResources = new Set([{ dispose }])
    table.winEffects = { reset: vi.fn() }
    table.clearDynamicScene()
    table.clearDynamicScene()
    expect(table.dynamicGroups).toBe(retainedArray)
    expect(table.dynamicGroups).toHaveLength(0)
    expect(transient.parent).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(table.dynamicResources.size).toBe(0)
  })

  it('uses the latest resize dimensions and caps pixel ratio on high-DPR phones', () => {
    const table = Object.create(ThreeTable.prototype)
    table.system = { windowWidth: 800, windowHeight: 450, pixelRatio: 1 }
    table.canvas = { width: 800, height: 450 }
    table.renderer = { setPixelRatio: vi.fn(), setSize: vi.fn() }
    table.camera = new THREE.PerspectiveCamera(39, 16 / 9)
    table.resize({ windowWidth: 1024, windowHeight: 768, pixelRatio: 3 })
    expect(table.camera.aspect).toBe(4 / 3)
    expect(table.camera.fov).toBeGreaterThan(39)
    expect(table.renderer.setSize).toHaveBeenCalledWith(1024, 768, false)
    expect(table.renderer.setPixelRatio).toHaveBeenCalledWith(2)
    table.resize({ windowWidth: 1280, windowHeight: 720 })
    expect(table.camera.fov).toBe(39)
  })

  it('replaces immutable WebGL texture storage when the HUD canvas resizes', () => {
    const table = Object.create(ThreeTable.prototype)
    table.overlayScene = new THREE.Scene()
    const canvas = { width: 800, height: 450 }
    table.setOverlay(canvas)
    const firstTexture = table.overlayTexture
    const disposed = vi.fn()
    firstTexture.addEventListener('dispose', disposed)
    table.markOverlayDirty()
    expect(table.overlayTexture).toBe(firstTexture)
    canvas.width = 1024
    canvas.height = 768
    table.markOverlayDirty()
    expect(table.overlayTexture).not.toBe(firstTexture)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(table.overlayScene.children).toHaveLength(1)
    table.setOverlay(null)
    expect(table.overlayScene.children).toHaveLength(0)
  })
})
