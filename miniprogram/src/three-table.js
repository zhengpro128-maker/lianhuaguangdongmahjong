import * as THREE from 'three'
import { createStaticTableScene } from '../../src/components/table/three/staticTableScene.ts'
import { defaultTableTheme } from '../../src/components/table/three/tableTheme.ts'
import { createTileInstanceRenderer } from '../../src/components/table/three/tileInstanceRenderer.ts'
import { createTableTilePresenter } from '../../src/components/table/three/tableTilePresenter.ts'
import { createDicePresenter } from '../../src/components/table/three/dicePresenter.ts'
import { createWinEffectPresenter } from '../../src/components/table/three/winEffectPresenter.ts'
import { tileMarkerFor } from '../../src/components/table/three/tileMarker.ts'
import { DEFAULT_TABLE_SCENE_PROFILE, applyRendererProfile, applyDirectionalShadowProfile, responsiveCameraFov } from '../../src/components/table/three/sceneRenderProfile.ts'
import { TABLE_LAYOUT } from '../../src/game/core/presentation/tableLayout.ts'
import { TILE_TYPES, tileFaceFile } from '../../src/game/core/rules/tiles.ts'

const PLAY_AREA_OFFSET_Z = -1.65
const TILE_LAYER_Z = -1

/** Only the canvas factory is needed by the shared browser scene presenters. */
function installCanvasFactory() {
  if (typeof globalThis.document === 'undefined') {
    const createCanvas = name => {
      if (name !== 'canvas') throw new Error(`小游戏不支持 DOM 元素：${name}`)
      return wx.createCanvas()
    }
    globalThis.document = {
      createElement: createCanvas,
      createElementNS: (_namespace, name) => createCanvas(name),
    }
  }
}

/** wx Canvas is not a DOM node. Three only requires these lifecycle events. */
export function ensureCanvasEvents(canvas) {
  if (typeof canvas.addEventListener === 'function' && typeof canvas.removeEventListener === 'function') return false
  const listeners = new Map()
  canvas.addEventListener = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(callback)
  }
  canvas.removeEventListener = (type, callback) => listeners.get(type)?.delete(callback)
  canvas.dispatchEvent = event => {
    for (const callback of listeners.get(event.type) ?? []) callback.call(canvas, event)
    return !event.defaultPrevented
  }
  return true
}

function loadTileImage(tile) {
  return new Promise((resolve, reject) => {
    const image = wx.createImage()
    const src = `assets/tiles/${tileFaceFile(tile)}`
    const timeout = setTimeout(() => finish(new Error(`牌面读取超时：${src}`)), 15000)
    let settled = false
    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve([tile, image])
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error(`牌面读取失败：${src}`))
    image.src = src
  })
}

/** Mirror GameTableHud's Wuhan-specific GamePort → MahjongTable3D mapping. */
export function miniTableProps(state = {}) {
  const source = state.tableProps ?? state
  return {
    players: [], localSeat: 0, currentPlayer: -1, lastDiscard: null,
    wall: [], wallHeadDrawn: 0, wallCount: 0, wallTotal: 120, horses: [],
    revealHands: false, winnerIndex: -1, winEffect: null, winPresentation: null,
    jokerTiles: [], wildcardTiles: [], jokerAsLaizi: true,
    dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
    openingStage: null, diceValues: [1, 1], dealerIndex: 0, diceThrowerIndex: 0,
    tableActionEvent: null, flipStackRemoved: false,
    ...source,
    themeName: 'jade',
    localSeat: source.localSeat ?? source.user?.seat ?? 0,
    dealerIndex: source.dealerIndex ?? source.dealer ?? 0,
    winnerIndex: source.winnerIndex ?? source.winningPlayerIndex ?? -1,
    horses: source.horses ?? source.result?.horses ?? [],
    wallTotal: 120,
    jokerAsLaizi: true,
    // Wuhan's flipped indicator stays in the ordinary drawable wall. The
    // browser deliberately supplies no flipStack to its 3D presenter: passing
    // the rules' historical flipStack here leaves a permanent phantom tile
    // after that wall position has already been drawn. Only the HUD uses it.
    flipStack: undefined,
    flipStackRemoved: false,
  }
}

/** Exclude HUD-only data so selection/countdown updates do not rebuild tile meshes. */
export function miniTableSignature(props) {
  return JSON.stringify([
    props.players.map(player => [player.hand, player.concealedTileCount, player.drawnTileIndex,
      player.discards, player.melds, player.redCount]),
    props.localSeat, props.lastDiscard, props.wall.length, props.wallHeadDrawn,
    props.wallTotal, props.wallBreakIndex, props.flipStack, props.flipStackRemoved,
    props.flipTile, props.jokerTiles, props.wildcardTiles, props.jokerAsLaizi,
    props.revealHands, props.winnerIndex, props.winEffect, props.winPresentation,
    props.horses, props.dealAnimation, props.tableActionEvent,
    props.dealerIndex, props.diceValues, props.openingStage,
  ])
}

/**
 * Native Mini Game WebGL scene. The exact browser geometry, tile atlas, wall
 * layout, meld orientation and motions are shared; the screen HUD owns hands.
 */
export class ThreeTable {
  constructor(canvas, system, options = {}) {
    installCanvasFactory()
    this.canvas = canvas
    this.system = system
    this.options = options
    this.disposed = false
    this.loaded = false
    this.contextLost = false
    this.syntheticCanvasEvents = ensureCanvasEvents(canvas)
    this.staticResources = new Set()
    this.dynamicResources = new Set()
    this.dynamicGroups = []
    this.props = miniTableProps()
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x03100b)
    this.scene.fog = new THREE.Fog(0x03100b, 32, 60)
    const profile = DEFAULT_TABLE_SCENE_PROFILE
    this.camera = new THREE.PerspectiveCamera(profile.camera.fov, 1, .1, 60)
    this.camera.position.set(0, profile.camera.positionY, profile.camera.positionZ)
    this.camera.lookAt(0, 0, profile.camera.lookAtZ)
    this.scratchVector = new THREE.Vector3()
    // Match the browser's mobile profile: DPR 2 and 512px soft shadows.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    applyRendererProfile(this.renderer, profile)
    this.onContextLost = event => {
      event.preventDefault?.()
      this.contextLost = true
      this.options.onContextLost?.()
    }
    this.onContextRestored = () => {
      if (this.disposed) return
      this.contextLost = false
      this.markOverlayDirty()
      this.options.invalidate?.()
      this.options.onContextRestored?.()
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.overlayScene = new THREE.Scene()
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.signature = ''
    this.machineSignature = ''
    this.resize(system)
    this.ready = Promise.all(TILE_TYPES.map(loadTileImage)).then(entries => {
      if (this.disposed) return this
      this.scene.userData.tileImages = new Map(entries)
      this.buildScene()
      this.loaded = true
      this.update(this.props)
      this.options.invalidate?.()
      this.options.onReady?.()
      return this
    }).catch(error => {
      this.options.onError?.(error)
      throw error
    })
  }

  own(resource) { this.staticResources.add(resource); return resource }
  ownDynamic(resource) { this.dynamicResources.add(resource); return resource }

  buildScene() {
    const profile = DEFAULT_TABLE_SCENE_PROFILE
    this.scene.add(new THREE.HemisphereLight(profile.hemisphere.skyColor, profile.hemisphere.groundColor, profile.hemisphere.intensity))
    const key = new THREE.DirectionalLight(profile.keyLight.color, profile.keyLight.intensity)
    key.position.set(...profile.keyLight.position)
    key.target.position.set(0, 0, profile.keyLight.targetZ)
    applyDirectionalShadowProfile(key, profile)
    key.shadow.mapSize.set(512, 512)
    this.own(key.shadow)
    this.scene.add(key, key.target)
    const rim = new THREE.DirectionalLight(defaultTableTheme.rimLight?.color ?? 0x3acb8b, defaultTableTheme.rimLight?.intensity ?? 1.6)
    rim.position.set(8, 5, -8)
    this.scene.add(rim)
    this.browserTable = createStaticTableScene({
      renderer: this.renderer, scene: this.scene, props: this.props,
      playAreaOffsetZ: PLAY_AREA_OFFSET_Z, theme: defaultTableTheme,
      own: resource => this.own(resource), ownDynamic: resource => this.ownDynamic(resource),
      trackTileMaterial: material => material, isGlossy: () => true, animeTable: false,
    })
    this.browserTable.addTable()
    this.tileInstances = createTileInstanceRenderer({
      scene: this.scene, capacity: 260,
      ownDynamic: resource => this.ownDynamic(resource), dynamicGroups: this.dynamicGroups,
      getAtlasMaterial: this.browserTable.getAtlasMaterial,
      getAtlasCapGeometry: this.browserTable.getAtlasCapGeometry,
      atlasCellUvFor: this.browserTable.atlasCellUvFor,
      getJokerAtlasMaterial: this.browserTable.getJokerAtlasMaterial,
      getWildcardAtlasMaterial: this.browserTable.getWildcardAtlasMaterial,
      getLaiziAtlasMaterial: this.browserTable.getLaiziAtlasMaterial,
      isJoker: tile => tileMarkerFor(tile, this.props.jokerTiles, this.props.wildcardTiles, this.props.jokerAsLaizi) === 'joker',
      isWildcard: tile => tileMarkerFor(tile, this.props.jokerTiles, this.props.wildcardTiles, this.props.jokerAsLaizi) === 'wildcard',
      isLaizi: tile => tileMarkerFor(tile, this.props.jokerTiles, this.props.wildcardTiles, this.props.jokerAsLaizi) === 'laizi',
    })
    this.tableTiles = createTableTilePresenter({
      props: this.props, scene: this.scene, dynamicGroups: this.dynamicGroups,
      ownDynamic: resource => this.ownDynamic(resource), clearDynamicScene: () => this.clearDynamicScene(),
      makeFaceTile: tile => this.makeFaceTile(tile), tableScene: this.browserTable, tileInstances: this.tileInstances,
      tileLayerZ: TILE_LAYER_Z, playAreaOffsetZ: PLAY_AREA_OFFSET_Z,
      tileGapOffset: TABLE_LAYOUT.tilePitch, pointGapOffset: TABLE_LAYOUT.sourcePitch, wallDealOriginY: 1.1,
      addWinEffect: () => this.winEffects?.addWinEffect(),
      addWinningDisplayTile: () => this.winEffects?.addWinningDisplayTile(),
    })
    this.winEffects = createWinEffectPresenter({
      props: this.props, scene: this.scene, camera: this.camera, tileLayerZ: TILE_LAYER_Z,
      dynamicGroups: this.dynamicGroups, own: resource => this.own(resource), ownDynamic: resource => this.ownDynamic(resource),
      makeFaceTile: tile => this.makeFaceTile(tile),
      meldTransform: this.tableTiles.meldTransform, alignMeldBottom: this.tableTiles.alignMeldBottom,
      sourceTileRotationOffset: this.tableTiles.sourceTileRotationOffset,
    })
    this.dice = createDicePresenter({
      scene: this.scene, own: resource => this.own(resource), tileLayerZ: TILE_LAYER_Z,
      getOpeningStage: () => this.props.openingStage,
      getValues: () => this.props.diceValues, getThrowerIndex: () => this.props.diceThrowerIndex,
    })
  }

  makeFaceTile(tileName) {
    const data = this.scene.userData
    const group = new THREE.Group()
    const base = new THREE.Mesh(data.tileBaseGeometry, [data.faceSide, data.faceSide, data.faceSide, data.backMaterial, data.faceSide, data.faceSide])
    base.position.y = -.06
    const marker = tileMarkerFor(tileName, this.props.jokerTiles, this.props.wildcardTiles, this.props.jokerAsLaizi)
    const cap = new THREE.Mesh(data.tileCapGeometry, [data.tileSide, data.tileSide,
      this.browserTable.makeFaceMaterial(tileName, marker), data.tileBottom, data.tileSide, data.tileSide])
    cap.position.y = .13
    base.castShadow = cap.castShadow = base.receiveShadow = cap.receiveShadow = true
    group.add(base, cap)
    return group
  }

  clearDynamicScene() {
    this.dynamicGroups.splice(0).forEach(group => group.removeFromParent())
    this.winEffects?.reset()
    this.dynamicResources.forEach(resource => resource.dispose?.())
    this.dynamicResources.clear()
  }

  update(state) {
    if (this.disposed) return
    const next = miniTableProps(state)
    // Presenters keep this object by reference, so do not replace its identity.
    Object.keys(this.props).forEach(key => { if (!(key in next)) delete this.props[key] })
    Object.assign(this.props, next)
    if (!this.loaded) return
    const machineSignature = `${this.props.currentPlayer}/${this.props.wallCount}/${this.props.dealerIndex}`
    if (machineSignature !== this.machineSignature) {
      this.machineSignature = machineSignature
      this.browserTable.updateMachineTexture()
    }
    const signature = miniTableSignature(this.props)
    if (signature !== this.signature) {
      this.signature = signature
      if (this.props.players.length) this.tableTiles.rebuild()
      else this.clearDynamicScene()
    }
  }

  /** HUD is drawn at CSS screen coordinates on an independent transparent canvas. */
  setOverlay(canvas, force = false) {
    if (!force && this.overlayTexture?.image === canvas) return
    this.overlayMesh?.removeFromParent()
    this.overlayMesh?.geometry.dispose()
    this.overlayMesh?.material.dispose()
    this.overlayTexture?.dispose()
    this.overlayMesh = null
    this.overlayTexture = null
    if (!canvas || this.disposed) return
    this.overlayTexture = new THREE.CanvasTexture(canvas)
    this.overlayWidth = canvas.width
    this.overlayHeight = canvas.height
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace
    this.overlayTexture.minFilter = THREE.LinearFilter
    this.overlayTexture.magFilter = THREE.LinearFilter
    this.overlayTexture.generateMipmaps = false
    const material = new THREE.MeshBasicMaterial({ map: this.overlayTexture,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    this.overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.overlayMesh.frustumCulled = false
    this.overlayScene.add(this.overlayMesh)
  }

  markOverlayDirty() {
    if (!this.overlayTexture) return
    const canvas = this.overlayTexture.image
    // WebGL2 texture storage is immutable after first upload. A resized HUD
    // needs fresh storage, otherwise landscape/tablet resize can go blank.
    if (canvas.width !== this.overlayWidth || canvas.height !== this.overlayHeight) this.setOverlay(canvas, true)
    this.overlayTexture.needsUpdate = true
  }

  resize(system = this.system) {
    if (this.disposed) return
    this.system = { ...this.system, ...system }
    const width = Math.max(1, this.system.windowWidth || this.canvas.width)
    const height = Math.max(1, this.system.windowHeight || this.canvas.height)
    this.renderer.setPixelRatio(Math.min(this.system.pixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.fov = responsiveCameraFov(DEFAULT_TABLE_SCENE_PROFILE.camera.fov, this.camera.aspect)
    this.camera.updateProjectionMatrix()
    this.markOverlayDirty()
  }

  render() {
    if (this.disposed) return false
    if (this.syntheticCanvasEvents) {
      // Some hosts expose isContextLost but no event API. Forward transitions
      // through the same listeners so Three can rebuild its internal GL state.
      const lost = this.renderer.getContext().isContextLost?.() ?? false
      if (lost !== this.contextLost) this.canvas.dispatchEvent({
        type: lost ? 'webglcontextlost' : 'webglcontextrestored',
        preventDefault() { this.defaultPrevented = true },
      })
    }
    if (this.contextLost) return false
    // WeChat RAF timestamps may use a different epoch; presenters use performance.now().
    const time = performance.now()
    const active = this.tableTiles?.animate(time, this.scratchVector) ?? false
    const diceActive = this.dice?.animate(time) ?? false
    const frame = this.winEffects?.animate(time)
    const profile = DEFAULT_TABLE_SCENE_PROFILE
    this.renderer.toneMappingExposure = frame?.exposure ?? profile.exposure
    this.camera.position.set(frame?.shakeX ?? 0, profile.camera.positionY, profile.camera.positionZ + (frame?.shakeZ ?? 0))
    this.camera.lookAt(0, 0, profile.camera.lookAtZ)
    this.renderer.autoClear = true
    this.renderer.render(this.scene, this.camera)
    if (this.overlayMesh) {
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.overlayScene, this.overlayCamera)
      this.renderer.autoClear = true
    }
    return active || diceActive || Boolean(frame)
  }

  dispose() {
    if (this.disposed) return
    this.setOverlay(null)
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.clearDynamicScene()
    this.staticResources.forEach(resource => resource.dispose?.())
    this.staticResources.clear()
    this.scene.clear()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
  }
}
