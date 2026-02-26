/**
 * Live race viewer — Three.js isometric 3D scene (performance-optimized).
 *
 * Key optimizations vs. previous version:
 *   1. InstancedMesh (1 draw call for all cars) instead of 6 cloned GLTF scenes
 *   2. CanvasTexture frozen after first render (no per-frame GPU re-upload)
 *   3. MeshBasicMaterial everywhere — no lights, no PBR
 *   4. Renderer flags tuned for software WebGL (WSL2 / mesa)
 *   5. Static objects: matrixAutoUpdate=false, frustumCulled=false
 *   6. Zero per-frame allocations — all Vector3/Matrix4/Quaternion reused
 *   7. Flat LUT entries (6 numbers) instead of Vector3 wrappers
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { api, wsUrl } from '../api.js'
import { navigate } from '../router.js'

// ── Central config ──────────────────────────────────────────────────────────────

const VIEWER_CONFIG = {
  // Track rendering
  TILE_SIZE: 4.0,

  // Camera
  CAM_FRUSTUM_HALF: 15,
  CAM_OFFSET:    { x: 9, y: 9, z: 9 },
  CAM_LERP:      0.12,

  // Cars
  CAR_SCALE: 0.9,
  CAR_Y:     0.5,

  // Movement smoothing
  ROT_SLERP:        0.45,

  // Movement interpolation
  LERP_SPEED:       0.25,

  // Tile → PNG mapping (Road_01 set)
  TILE_MAP: {
    'straight/horizontal': 3,
    'straight/vertical':   9,
    'curve/NE':            2,
    'curve/NW':            1,
    'curve/SE':            5,
    'curve/SW':            6,
    'chicane/horizontal':  7,
    'chicane/vertical':    8,
  },
  TILE_ROAD_SET: 'Road_01',

  // Tile rotation on world Y axis (radians)
  TILE_ROTATION: {
    'straight/horizontal': 0,
    'straight/vertical':   Math.PI / 2,
    'curve/NE':            0,
    'curve/NW':            Math.PI / 2,
    'curve/SE':           -Math.PI / 2,
    'curve/SW':            Math.PI,
    'chicane/horizontal':  0,
    'chicane/vertical':    Math.PI / 2,
  },

  // Canvas baking resolution
  TILE_PX_MAX: 256,
  CANVAS_MAX: 4096,
}

const CAR_COLORS = [
  0xe8c84a, // gold
  0x4a9be8, // blue
  0xe84a4a, // red
  0x4ae84a, // green
  0xe84ae8, // purple
  0x4ae8e8, // cyan
]
const CAR_COLOR_HEX = CAR_COLORS.map(c => '#' + c.toString(16).padStart(6, '0'))

// ── Tile texture helper ─────────────────────────────────────────────────────────

function tileTexUrl(type, orientation) {
  const n = String(VIEWER_CONFIG.TILE_MAP[`${type}/${orientation}`] ?? 1).padStart(2, '0')
  const set = VIEWER_CONFIG.TILE_ROAD_SET
  return `/static/PNG/${set}/${set}_Tile_${n}/${set}_Tile_${n}.png`
}

// ── Image loader (async, cached) ────────────────────────────────────────────────

const imgCache = {}

function loadImage(url) {
  if (imgCache[url]) return imgCache[url]
  const p = new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
  imgCache[url] = p
  return p
}

// ── Main view ───────────────────────────────────────────────────────────────────

export function renderRace(container, raceId) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold" id="race-title">Race <span class="text-track-muted text-sm">${raceId}</span></h2>
        <button id="race-back" class="btn-ghost text-xs">\u2190 Schedule</button>
      </div>

      <!-- Canvas -->
      <div id="race-canvas-wrap" class="card p-0 overflow-hidden" style="height:480px; position:relative;">
        <canvas id="race-canvas" class="w-full h-full block"></canvas>
        <div id="race-overlay" class="absolute inset-0 flex items-center justify-center bg-track-bg/80 text-track-muted text-sm" style="pointer-events:none">
          Connecting\u2026
        </div>
        <div id="lap-counter" class="absolute top-3 left-3 bg-track-bg/80 text-track-accent text-sm font-bold px-3 py-1 rounded" style="pointer-events:none; display:none">
          Lap 1 / 1
        </div>
      </div>

      <!-- Live leaderboard + garage stats -->
      <div class="grid grid-cols-2 gap-4">
        <div id="race-leaderboard" class="card">
          <h3 class="text-sm font-bold mb-2">Leaderboard</h3>
          <div id="leaderboard-rows" class="space-y-1 text-sm font-mono"></div>
        </div>
        <div id="race-stats" class="card">
          <h3 class="text-sm font-bold mb-2">Your Car</h3>
          <div id="stats-event" class="text-xs text-track-muted mb-2"></div>
          <div id="stats-rows" class="space-y-1 text-xs"></div>
          <div id="stats-speed" class="mt-2 text-track-accent font-bold text-sm"></div>
        </div>
      </div>

      <!-- Live log -->
      <div id="race-log" class="card text-xs text-track-muted space-y-1 max-h-48 overflow-y-auto font-mono"></div>

      <!-- Final results -->
      <div id="race-entrants" class="card"></div>
    </div>`

  document.getElementById('race-back').onclick = () => navigate('/schedule')

  const canvas     = document.getElementById('race-canvas')
  const overlay    = document.getElementById('race-overlay')
  const log        = document.getElementById('race-log')
  const lapCounter = document.getElementById('lap-counter')
  const speedEl    = document.getElementById('stats-speed')

  // Defer heavy Three.js init to next frame so the page layout paints first.
  requestAnimationFrame(() => initScene(
    container, raceId, canvas, overlay, log, lapCounter, speedEl
  ))
}

function initScene(container, raceId, canvas, overlay, log, lapCounter, speedEl) {
  // ── Three.js setup (optimized for software WebGL) ─────────────────────────────

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    precision: 'lowp',
    stencil: false,
    depth: true,
    preserveDrawingBuffer: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setClearColor(0x0f1117)

  const wrap = document.getElementById('race-canvas-wrap')
  const W = wrap.clientWidth
  const H = wrap.clientHeight
  renderer.setSize(W, H)

  const aspect = W / H
  const d = VIEWER_CONFIG.CAM_FRUSTUM_HALF
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000)
  camera.position.set(
    VIEWER_CONFIG.CAM_OFFSET.x,
    VIEWER_CONFIG.CAM_OFFSET.y,
    VIEWER_CONFIG.CAM_OFFSET.z
  )
  camera.lookAt(0, 0, 0)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0f1117)
  // No lights — MeshBasicMaterial doesn't need them

  // Cache the isometric quaternion — never changes after this
  const _fixedCamQuat = camera.quaternion.clone()

  // ── State ─────────────────────────────────────────────────────────────────────

  let carTargetT = {}
  let carRenderT = {}
  let carIncident = {}
  let animFrameId = null
  let ws = null
  let entrants = []
  let finished = false
  let lapCount = 1
  let visualLapCount = 1
  let myPlayerId = null
  let carData = null
  let carsSpawned = false
  let groundMesh = null
  let groundTexture = null
  let firstFrameRendered = false

  // InstancedMesh state
  let carMesh = null          // single THREE.InstancedMesh for all cars
  let carGeometry = null      // extracted/merged geometry from GLTF
  let gltfReady = false

  // ── Reusable objects (ZERO per-frame allocations) ─────────────────────────────
  const _camTarget = new THREE.Vector3()
  const _pos       = new THREE.Vector3()
  const _tan       = new THREE.Vector3()
  const _quat      = new THREE.Quaternion()
  const _targetQ   = new THREE.Quaternion()
  const _up        = new THREE.Vector3(0, 1, 0)
  const _mat4      = new THREE.Matrix4()
  const _scale     = new THREE.Vector3(VIEWER_CONFIG.CAR_SCALE, VIEWER_CONFIG.CAR_SCALE, VIEWER_CONFIG.CAR_SCALE)
  const _color     = new THREE.Color()

  // Per-car quaternion cache for slerp (indexed by entrant position)
  let _carQuats = []

  const camOx = VIEWER_CONFIG.CAM_OFFSET.x
  const camOy = VIEWER_CONFIG.CAM_OFFSET.y
  const camOz = VIEWER_CONFIG.CAM_OFFSET.z

  // Pre-sampled curve lookup table (flat numbers, no Vector3 wrappers)
  const LUT_SIZE = 512
  let curveLUT = null   // Array of { px, py, pz, tx, ty, tz }

  // Car index array — avoids Object.entries() allocation every frame
  // Maps entrant index (0-5) → car_id string
  const carIds = []
  // Reverse map: car_id → entrant index
  const carIdToIndex = new Map()

  // ── Build track ───────────────────────────────────────────────────────────────

  function buildTrack(trackData) {
    const { path_order } = trackData
    const ts = VIEWER_CONFIG.TILE_SIZE

    // CatmullRomCurve3 from path_order centre points (closed loop)
    const pts = path_order.map(([x, y]) => new THREE.Vector3(x * ts, 0.15, y * ts))
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5)
    curve.arcLengthDivisions = pts.length * 10

    // Pre-sample into flat LUT (6 numbers per entry, no Vector3)
    curveLUT = new Array(LUT_SIZE)
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / LUT_SIZE
      const p = curve.getPointAt(t)
      const n = curve.getTangentAt(t)
      curveLUT[i] = { px: p.x, py: p.y, pz: p.z, tx: n.x, ty: n.y, tz: n.z }
    }

    // Bake ground texture asynchronously
    bakeGround(trackData)
  }

  async function bakeGround(trackData) {
    const { tiles, grid_width, grid_height } = trackData
    const ts = VIEWER_CONFIG.TILE_SIZE

    const maxDim = Math.max(grid_width, grid_height)
    const tilePx = Math.min(
      VIEWER_CONFIG.TILE_PX_MAX,
      Math.floor(VIEWER_CONFIG.CANVAS_MAX / maxDim)
    )
    const canvasW = grid_width * tilePx
    const canvasH = grid_height * tilePx

    const offscreen = document.createElement('canvas')
    offscreen.width = canvasW
    offscreen.height = canvasH
    const ctx = offscreen.getContext('2d')

    // Preload images in parallel
    const grassUrl = '/static/PNG/Background_Tiles/Grass_Tile.png'
    const tileUrls = new Set()
    for (const tile of tiles) {
      tileUrls.add(tileTexUrl(tile.type, tile.orientation))
    }
    const allUrls = [grassUrl, ...tileUrls]
    const images = await Promise.all(allUrls.map(loadImage))
    const imgMap = {}
    allUrls.forEach((url, i) => { imgMap[url] = images[i] })

    if (destroyed) return

    // 1. Fill with grass
    const grassImg = imgMap[grassUrl]
    if (grassImg) {
      for (let gy = 0; gy < grid_height; gy++) {
        for (let gx = 0; gx < grid_width; gx++) {
          ctx.drawImage(grassImg, gx * tilePx, gy * tilePx, tilePx, tilePx)
        }
      }
    } else {
      ctx.fillStyle = '#2a3a1a'
      ctx.fillRect(0, 0, canvasW, canvasH)
    }

    // 2. Draw road tiles on top (with rotation)
    for (const tile of tiles) {
      const key = `${tile.type}/${tile.orientation}`
      const url = tileTexUrl(tile.type, tile.orientation)
      const img = imgMap[url]
      if (!img) continue

      const rotation = VIEWER_CONFIG.TILE_ROTATION[key] ?? 0
      const cx = (tile.x + 0.5) * tilePx
      const cy = (tile.y + 0.5) * tilePx

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-rotation)
      ctx.drawImage(img, -tilePx / 2, -tilePx / 2, tilePx, tilePx)
      ctx.restore()
    }

    // 3. Create ground mesh with a plain THREE.Texture (NOT CanvasTexture)
    //    CanvasTexture overrides needsUpdate getter to always return true,
    //    causing a full GPU re-upload every frame. Using plain Texture + manual
    //    needsUpdate=true gives us a single upload, then it stays false forever.
    groundTexture = new THREE.Texture(offscreen)
    groundTexture.colorSpace = THREE.SRGBColorSpace
    groundTexture.generateMipmaps = false
    groundTexture.minFilter = THREE.LinearFilter
    groundTexture.needsUpdate = true  // upload once on next render

    const groundGeo = new THREE.PlaneGeometry(grid_width * ts, grid_height * ts)
    const groundMat = new THREE.MeshBasicMaterial({ map: groundTexture })
    groundMesh = new THREE.Mesh(groundGeo, groundMat)
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.position.set((grid_width - 1) * ts / 2, -0.01, (grid_height - 1) * ts / 2)

    // Static object optimizations
    groundMesh.matrixAutoUpdate = false
    groundMesh.updateMatrix()
    groundMesh.frustumCulled = false

    scene.add(groundMesh)
  }

  // ── Car spawning (InstancedMesh) ──────────────────────────────────────────────

  function spawnCars() {
    if (carsSpawned) return
    if (!gltfReady || !curveLUT || entrants.length === 0) return
    carsSpawned = true

    const count = entrants.length
    const mat = new THREE.MeshBasicMaterial()  // single material, no lighting

    carMesh = new THREE.InstancedMesh(carGeometry, mat, count)
    carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // Per-instance colors (set once)
    entrants.forEach((e, i) => {
      _color.setHex(CAR_COLORS[i % CAR_COLORS.length])
      carMesh.setColorAt(i, _color)
    })
    carMesh.instanceColor.needsUpdate = true

    // Initialize all instances at origin with correct scale
    for (let i = 0; i < count; i++) {
      _pos.set(0, VIEWER_CONFIG.CAR_Y, 0)
      _quat.identity()
      _mat4.compose(_pos, _quat, _scale)
      carMesh.setMatrixAt(i, _mat4)
    }
    carMesh.instanceMatrix.needsUpdate = true

    // Static mesh-level properties
    carMesh.matrixAutoUpdate = false
    carMesh.updateMatrix()
    carMesh.frustumCulled = false

    // Initialize per-car quaternion cache for slerp
    _carQuats = []
    for (let i = 0; i < count; i++) {
      _carQuats.push(new THREE.Quaternion())
    }

    scene.add(carMesh)
  }

  // ── Animation loop ────────────────────────────────────────────────────────────

  // Sample the curve LUT with linear interpolation (writes into _pos and _tan)
  // Uses inlined math — no lerpVectors, no allocations
  function sampleLUT(t) {
    const raw = ((t % 1.0) + 1.0) % 1.0
    const f   = raw * LUT_SIZE
    const i0  = Math.floor(f) % LUT_SIZE
    const i1  = (i0 + 1) % LUT_SIZE
    const a   = f - Math.floor(f)
    const s0  = curveLUT[i0]
    const s1  = curveLUT[i1]

    // Inline lerp — no Vector3.lerpVectors() call
    _pos.x = s0.px + (s1.px - s0.px) * a
    _pos.y = s0.py + (s1.py - s0.py) * a
    _pos.z = s0.pz + (s1.pz - s0.pz) * a
    _tan.x = s0.tx + (s1.tx - s0.tx) * a
    _tan.y = s0.ty + (s1.ty - s0.ty) * a
    _tan.z = s0.tz + (s1.tz - s0.tz) * a
  }

  function updateCarInstance(index, carId) {
    const target  = carTargetT[carId] ?? 0
    const current = carRenderT[carId] ?? 0
    const renderT = current + (target - current) * VIEWER_CONFIG.LERP_SPEED
    carRenderT[carId] = renderT

    sampleLUT(renderT)

    // Compute target rotation from tangent
    const angle = Math.atan2(_tan.x, _tan.z)
    _targetQ.setFromAxisAngle(_up, angle)

    // Slerp from cached quaternion toward target
    const carQ = _carQuats[index]
    carQ.slerp(_targetQ, VIEWER_CONFIG.ROT_SLERP)

    // Apply incident wobble as angle offset
    let finalQ = carQ
    if (carIncident[carId] > 0) {
      const wobble = Math.sin(carIncident[carId] * 0.8) * 0.12
      _quat.setFromAxisAngle(_up, wobble)
      _quat.premultiply(carQ)
      finalQ = _quat
      carIncident[carId]--
    }

    // Compose transform and write to instance matrix
    _pos.y = VIEWER_CONFIG.CAR_Y
    _mat4.compose(_pos, finalQ, _scale)
    carMesh.setMatrixAt(index, _mat4)

    return renderT
  }

  function animate() {
    animFrameId = requestAnimationFrame(animate)

    if (!curveLUT) {
      renderer.render(scene, camera)
      return
    }

    let leaderProgress = -1

    if (carMesh) {
      for (let i = 0; i < carIds.length; i++) {
        const carId = carIds[i]
        const renderT = updateCarInstance(i, carId)
        if (renderT > leaderProgress) {
          leaderProgress = renderT
          _camTarget.set(_pos.x + camOx, _pos.y + camOy, _pos.z + camOz)
        }
      }
      carMesh.instanceMatrix.needsUpdate = true
    }

    // Camera follows leader — translate only, orientation stays fixed isometric
    if (leaderProgress >= 0) {
      camera.position.lerp(_camTarget, VIEWER_CONFIG.CAM_LERP)
      camera.quaternion.copy(_fixedCamQuat)
    }

    renderer.render(scene, camera)

    // After the very first render, ensure ground texture won't re-upload.
    // THREE.Texture resets needsUpdate to false after upload, but be explicit.
    if (!firstFrameRendered) {
      firstFrameRendered = true
      if (groundTexture) groundTexture.needsUpdate = false
    }
  }

  // ── GLTF loader (extract geometry, handle multi-mesh) ─────────────────────────

  const gltfLoader = new GLTFLoader()
  gltfLoader.load('/static/car.glb',
    (gltf) => {
      const meshes = []
      gltf.scene.traverse(child => {
        if (child.isMesh) meshes.push(child.geometry)
      })

      if (meshes.length === 1) {
        carGeometry = meshes[0]
      } else if (meshes.length > 1) {
        // Merge all submeshes into one geometry
        const merged = mergeGeometries(meshes)
        carGeometry = merged || new THREE.BoxGeometry(0.4, 0.2, 0.7)
      }

      if (!carGeometry) {
        carGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.7)
      }

      gltfReady = true
      if (entrants.length > 0 && curveLUT) spawnCars()
    },
    null,
    (_err) => {
      addLog('\u26a0 car.glb not found \u2014 cars will be represented as cubes')
      carGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.7)
      gltfReady = true
      if (entrants.length > 0 && curveLUT) spawnCars()
    }
  )

  // ── Log helper ────────────────────────────────────────────────────────────────

  function addLog(msg) {
    const p = document.createElement('p')
    p.textContent = msg
    log.appendChild(p)
    log.scrollTop = log.scrollHeight
    while (log.children.length > 80) log.removeChild(log.firstChild)
  }

  // ── Entrant panel ─────────────────────────────────────────────────────────────

  function renderEntrants(results) {
    const panel = document.getElementById('race-entrants')
    if (!panel) return
    if (results) {
      panel.innerHTML = `
        <h3 class="text-sm font-bold mb-3">Final Results</h3>
        <div class="space-y-2">
          ${results.map(r => `
            <div class="flex items-center gap-3 text-sm">
              <span class="w-8 text-track-accent font-bold">${r.position}.</span>
              <span class="flex-1">${r.username}</span>
              ${r.dnf ? '<span class="badge bg-red-900/50 text-red-400">DNF</span>' : ''}
              <span class="text-track-muted">${r.result_score.toFixed(1)} pts</span>
              <button class="btn-ghost text-xs view-result-btn" data-id="${raceId}" data-pid="${r.player_id}">Breakdown</button>
            </div>`).join('')}
        </div>`
      panel.querySelectorAll('.view-result-btn').forEach(btn => {
        btn.onclick = () => navigate(`/results/${btn.dataset.id}`)
      })
    } else if (entrants.length > 0) {
      panel.innerHTML = `
        <h3 class="text-sm font-bold mb-3">Entrants</h3>
        <div class="space-y-1">
          ${entrants.map((e, i) => `
            <div class="flex items-center gap-2 text-sm">
              <span class="w-3 h-3 rounded-full inline-block" style="background:${CAR_COLOR_HEX[i % CAR_COLOR_HEX.length]}"></span>
              <span>${e.username}</span>
            </div>`).join('')}
        </div>`
    }
  }

  // ── Live leaderboard ──────────────────────────────────────────────────────────

  const entrantIndexByCarId = new Map()

  let leaderboardRowEls = null

  function buildLeaderboardRows(count) {
    const rows = document.getElementById('leaderboard-rows')
    if (!rows) return
    rows.innerHTML = ''
    leaderboardRowEls = []
    for (let i = 0; i < count; i++) {
      const root = document.createElement('div')
      root.className = 'flex items-center gap-2'
      const pos = document.createElement('span')
      pos.className = 'w-5 text-track-muted'
      const dot = document.createElement('span')
      dot.className = 'w-2 h-2 rounded-full flex-shrink-0'
      const name = document.createElement('span')
      name.className = 'flex-1 truncate'
      const lap = document.createElement('span')
      lap.className = 'text-track-muted'
      const speed = document.createElement('span')
      speed.className = 'w-10 text-right text-track-accent'
      const dnf = document.createElement('span')
      dnf.className = 'text-red-400'
      root.append(pos, dot, name, lap, speed, dnf)
      rows.appendChild(root)
      leaderboardRowEls.push({ root, pos, dot, name, lap, speed, dnf })
    }
  }

  let sortBuf = []

  function updateLeaderboard(tickCars) {
    if (!leaderboardRowEls) return

    sortBuf.length = 0
    for (let i = 0; i < tickCars.length; i++) sortBuf.push(tickCars[i])
    sortBuf.sort((a, b) => b.progress - a.progress)

    for (let i = 0; i < leaderboardRowEls.length; i++) {
      const el = leaderboardRowEls[i]
      if (i >= sortBuf.length) {
        el.root.style.display = 'none'
        continue
      }
      el.root.style.display = ''
      const car = sortBuf[i]
      const carVisualT = car.progress * visualLapCount
      const lap = Math.min(visualLapCount, Math.floor(carVisualT) + 1)
      const idx = entrantIndexByCarId.get(car.car_id) ?? 0

      el.pos.textContent = `${i + 1}.`
      el.dot.style.background = CAR_COLOR_HEX[idx % CAR_COLOR_HEX.length]
      el.name.textContent = car.username
      el.lap.textContent = `Lap ${lap}`
      el.speed.textContent = `${car.speed.toFixed(0)}`
      el.dnf.textContent = car.incident === 'dnf' ? 'DNF' : ''
    }
  }

  // ── Garage stats panel ────────────────────────────────────────────────────────

  function renderGarageStats(data, eventType) {
    const eventEl = document.getElementById('stats-event')
    const rowsEl  = document.getElementById('stats-rows')
    if (!eventEl || !rowsEl) return
    eventEl.textContent = `Event: ${eventType.replace('_', ' ')}`
    const slotOrder = ['engine', 'tires', 'suspension', 'aero', 'fuel', 'electronics']
    rowsEl.innerHTML = slotOrder.map(s => {
      const slot = data.slots[s]
      if (!slot) return ''
      const r = slot.readiness
      const barW = Math.round(r)
      const barColor = r >= 70 ? 'bg-green-600' : r >= 40 ? 'bg-yellow-500' : 'bg-red-600'
      return `<div class="flex items-center gap-2">
        <span class="w-20 capitalize text-track-muted">${s}</span>
        <span class="w-14 text-xs">[${slot.tier.slice(0, 3)}]</span>
        <div class="flex-1 h-1.5 bg-track-bg rounded overflow-hidden">
          <div class="${barColor} h-full" style="width:${barW}%"></div>
        </div>
        <span class="w-9 text-right text-track-muted">${r.toFixed(0)}%</span>
      </div>`
    }).join('')
  }

  async function fetchAndShowStats(eventType) {
    try {
      const data = await api.car()
      carData = data
      renderGarageStats(data, eventType)
    } catch (_) { /* not logged in / no car */ }
  }

  function updateMySpeed(tickCars) {
    if (!speedEl || !myPlayerId) return
    for (let i = 0; i < tickCars.length; i++) {
      if (tickCars[i].car_id === myPlayerId) {
        speedEl.textContent = `${tickCars[i].speed.toFixed(0)} mph`
        return
      }
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────────

  function connectWs() {
    ws = new WebSocket(wsUrl(raceId))

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)

      if (msg.type === 'race_init') {
        entrants       = msg.entrants || []
        lapCount       = msg.lap_count ?? 1
        visualLapCount = lapCount
        myPlayerId     = msg.your_id ?? null

        entrantIndexByCarId.clear()
        carIds.length = 0
        carIdToIndex.clear()
        entrants.forEach((e, i) => {
          entrantIndexByCarId.set(e.car_id, i)
          carIds.push(e.car_id)
          carIdToIndex.set(e.car_id, i)
        })

        overlay.textContent = `${msg.event_type.replace('_', ' ')} \u2014 ${msg.status}`
        if (msg.status === 'running') overlay.style.display = 'none'
        if (msg.track) buildTrack(msg.track)
        if (gltfReady && entrants.length > 0 && curveLUT) spawnCars()
        buildLeaderboardRows(entrants.length)
        renderEntrants(null)
        fetchAndShowStats(msg.event_type)
        addLog(`Race: ${msg.event_type} | Status: ${msg.status} | Laps: ${lapCount}`)
      }

      else if (msg.type === 'status') {
        addLog(`Status \u2192 ${msg.status}`)
        if (msg.status === 'running') overlay.style.display = 'none'
      }

      else if (msg.type === 'tick') {
        if (msg.lap_count) {
          lapCount = msg.lap_count
          visualLapCount = lapCount
        }
        if (msg.tick === 1) {
          overlay.style.display = 'none'
          lapCounter.style.display = 'block'
          addLog(`Race started \u2014 ${msg.cars.length} cars on track`)
        }

        let leaderProgress = -1
        for (const car of msg.cars) {
          const totalT = car.progress * visualLapCount
          if (carTargetT[car.car_id] === undefined) {
            carRenderT[car.car_id] = totalT
          }
          carTargetT[car.car_id] = totalT
          if (car.progress > leaderProgress) leaderProgress = car.progress
          if (car.incident === 'dnf_start') {
            carIncident[car.car_id] = 20
            addLog(`\u26a0 ${car.username} \u2014 DNF incident`)
          }
        }

        if (leaderProgress >= 0) {
          const visualT = leaderProgress * visualLapCount
          const visualLap = Math.min(visualLapCount, Math.floor(visualT) + 1)
          lapCounter.textContent = `Lap ${visualLap} / ${visualLapCount}`
        }

        if (msg.tick & 1) updateLeaderboard(msg.cars)
        updateMySpeed(msg.cars)
      }

      else if (msg.type === 'finished') {
        finished = true
        addLog('Race finished!')
        lapCounter.textContent = `Lap ${visualLapCount} / ${visualLapCount}`
        renderEntrants(msg.results)
        overlay.style.display = 'none'
        ws.close()
      }

      else if (msg.type === 'ping') {
        // keepalive
      }

      else if (msg.type === 'error') {
        addLog(`Error: ${msg.detail}`)
      }
    }

    ws.onopen  = () => addLog('Connected to race broadcast')
    ws.onclose = () => {
      if (!finished && !destroyed) {
        addLog('Disconnected \u2014 reconnecting\u2026')
        setTimeout(() => { if (!finished && !destroyed) connectWs() }, 2000)
      }
    }
    ws.onerror = () => addLog('WebSocket error')
  }

  // ── Start ─────────────────────────────────────────────────────────────────────

  let destroyed = false
  animate()
  connectWs()

  // Cleanup when navigating away
  const origHash = location.hash

  function cleanup() {
    if (destroyed) return
    destroyed = true
    cancelAnimationFrame(animFrameId)
    window.removeEventListener('hashchange', onHashChange)

    // Dispose scene objects
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
    if (groundTexture) groundTexture.dispose()
    renderer.dispose()
    if (ws) ws.close()
  }

  function onHashChange() {
    if (location.hash !== origHash) cleanup()
  }

  window.addEventListener('hashchange', onHashChange)
}
