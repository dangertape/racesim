# Stack & Architecture

## Technology Choices

### Backend — FastAPI (Python)

- Native async handles WebSockets and scheduled jobs in a single process
- Pydantic models for free validation/serialization of race events and car state
- Auto-generated OpenAPI docs useful during development
- Starlette WebSocket support built-in

### Storage — JSON files

- All persistent state is stored as plain JSON files on disk — no database, no ORM, no migrations
- One file per logical entity: `data/players/{player_id}.json`, `data/races/{race_id}.json`, `data/schedule.json`
- Python's built-in `json` module handles all reads and writes; no third-party persistence libraries
- The scheduler job reads/writes JSON directly after the race completes
- Simple enough to inspect, edit, or reset by hand during development

### Scheduling — APScheduler

- `AsyncIOScheduler` runs inside the FastAPI event loop — no separate worker process
- Cron triggers for fixed daily race times
- Memory job store only (no DB-backed persistence) — schedule is defined in `data/schedule.json` (144 slots, every 10 minutes) and re-registered on startup

### Real-time — FastAPI WebSockets (built-in)

- Server pushes race simulation events to connected clients as the race runs
- In-memory `asyncio.Queue` fan-out per connected client — no Redis needed at this scale
- Scheduler job is the single write authority: runs sim, writes JSON, pushes to broadcaster

### Frontend — Vanilla JS + Vite + Tailwind CSS

- UI is a dashboard with async updates, not a deep component tree — no framework needed
- Vite: fast dev server with HMR, production bundling, `/api` proxy to backend
- Tailwind: consistent visual system without writing much CSS
- Hash-based routing (`#/garage`, `#/race/watch`) — server never handles frontend routes

### Race Viewer — Three.js (isometric 3D)

The race watch view (`#/race/watch`) renders an isometric 3D scene using Three.js rather than a flat text log or 2D canvas. The renderer is optimised for software WebGL environments (e.g. WSL2 / mesa).

**Camera setup:**
- `OrthographicCamera` positioned at a fixed isometric angle (e.g. 45° yaw, ~30° pitch — classic iso)
- Camera follows the race leader; no user-controlled orbit
- Isometric quaternion is cached once at init; only `camera.position` changes per frame
- Renderer targets a `<canvas>` element inside the watch panel; Tailwind handles surrounding layout
- Renderer flags tuned for software WebGL: `powerPreference: 'high-performance'`, `precision: 'lowp'`, `stencil: false`

**Car model:**
- Single shared `car.glb` asset (located at `car.glb` in the repo root, served as a static asset by Vite)
- Loaded once via `GLTFLoader`; geometry extracted (multi-mesh GLTFs merged via `BufferGeometryUtils.mergeGeometries()`)
- All cars rendered as a single `THREE.InstancedMesh` — one draw call for all cars regardless of grid size
- Per-instance colour via `setColorAt()` (set once); per-instance transform via `setMatrixAt()` (updated each frame with `DynamicDrawUsage` hint)
- `MeshBasicMaterial` — no lighting calculations needed at isometric scale
- Falls back to a simple `BoxGeometry` if `car.glb` is missing or contains no meshes

**Positioning and animation:**
- Backend emits race tick events over WebSocket: `{ car_id, progress, speed, incident }`
- Frontend maps `progress` (0–1 normalized lap progress) to a `CatmullRomCurve3` that follows the track layout
- The curve is pre-sampled into a 512-entry lookup table (LUT) at track build time; each entry stores 6 flat numbers (`px, py, pz, tx, ty, tz`) — no `Vector3` wrappers
- Per-frame car positioning uses index lookup + inlined linear interpolation (no `lerpVectors()` calls, zero allocations)
- Cars translate along the curve each animation frame; `requestAnimationFrame` loop drives rendering
- Incident events (spin, mechanical issue) trigger a short procedural rotation wobble applied as an angle offset before `setMatrixAt()`
- Per-car quaternions are cached and slerped toward the target each frame — no per-frame quaternion allocation

**Track rendering:**
- The track is a grid of square tiles baked into a single offscreen canvas at build time
- Tile types: straights (horizontal, vertical), curves (four 90° corner orientations), and chicanes
- The tile grid is received from the server as part of the race setup payload; tiles are drawn (with rotation) onto a single offscreen canvas, then uploaded to the GPU as one texture
- The ground texture uses `THREE.Texture` (not `CanvasTexture`) to prevent per-frame GPU re-upload — `needsUpdate` is set once and stays `false` after the first render
- A single `PlaneGeometry` mesh with `matrixAutoUpdate = false` and `frustumCulled = false` — zero per-frame overhead for the ground
- A `CatmullRomCurve3` is derived from the ordered centre-points of the tiles (in traversal order) and used solely to drive car positions — it is not rendered directly

**Scene composition — no lights:**
- The scene contains no lights (`AmbientLight`, `DirectionalLight` removed)
- All materials are `MeshBasicMaterial` — colour only, no PBR lighting calculations
- This eliminates per-vertex/per-fragment lighting passes entirely, which is significant on software WebGL

**Performance characteristics:**
- 2 draw calls per frame (1 instanced car mesh + 1 ground plane)
- 1 shader program (shared `MeshBasicMaterial`)
- 0 texture uploads after first frame
- 0 per-frame allocations (all `Vector3`, `Matrix4`, `Quaternion`, `Color` objects reused)
- Static objects skip matrix recalculation (`matrixAutoUpdate = false`)

**Shared live broadcast — not per-player replays:**
- The race is a single server-side event; all connected clients receive the identical tick stream at the same time via the existing `broadcast/race_broadcaster.py` fan-out
- Every viewer — whether they entered the race or not — watches the same scene simultaneously, like a live broadcast
- Late joiners connect to the WebSocket mid-race and render from the current tick onward; there is no seek/replay
- No additional backend work required — the viewer is a pure frontend concern

### Auth — Simple JWT (httpOnly cookie)

- Minimal hand-rolled auth: registration and login endpoints, `bcrypt` for password hashing, `PyJWT` for token generation
- Player credentials stored in `data/players/{player_id}.json` alongside game state
- JWT in httpOnly cookies — no localStorage exposure
- No third-party auth framework (no FastAPI-Users, no OAuth)

---

## Architectural Rules

### Simulation is pure and I/O-free

`simulation/engine.py` takes a plain dataclass snapshot as input and returns a list of events. No DB access, no network calls. This makes it:
- Unit-testable without mocking
- Runnable from the scheduler job, tests, or dev tooling identically

### Scheduler job is the single write authority for race results

`scheduler/jobs.py` → calls sim engine → writes result JSON to `data/races/` → pushes to broadcaster. No other code path writes race results. Prevents file-level race conditions.

### Broadcaster is a thin in-memory fan-out

`broadcast/race_broadcaster.py` holds `race_id → list[asyncio.Queue]`. Scheduler pushes events in; WebSocket handlers pull from their own queue. No message broker until horizontal scaling is needed.

### Frontend routing is hash-based

`#/garage`, `#/race/watch` etc. — Vite proxy only needs to forward `/api` and `/ws`. In production, serve built frontend from FastAPI `StaticFiles` or nginx.

### Bots fill empty grid slots

`backend/bots.py` generates bot entrants to fill race grids up to `BOT_GRID_TARGET` (default 6). Bots have randomised car builds and are distinguishable by their `bot_` ID prefix. They ensure races always have a competitive field even with few human players.

---

## Dev Setup

### Backend
```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
# data/ directory and race files are created automatically on first run
uvicorn backend.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Backend runs on `localhost:8000`, frontend dev server on `localhost:5173` with API proxy configured.

See `docs/maintenance.md` for full setup, reset, and operations instructions.
