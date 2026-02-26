# Race Viewer — Tunable Values Reference

Every number that affects how the race looks or plays is documented here.
Backend constants live in `backend/config.py`; frontend constants live in the
`VIEWER_CONFIG` object at the top of `frontend/src/views/race.js`.

---

## Race duration

| Constant | File | Default | Effect of increasing | Effect of decreasing |
|----------|------|---------|----------------------|----------------------|
| `RACE_LAP_COUNT_DEFAULT` | `backend/config.py` | `25` | Longer race, lap counter goes higher | Fewer laps, shorter race |
| `RACE_TICK_INTERVAL_MS` | `backend/config.py` | `62` | Slower broadcast (longer wall-clock race) | Faster broadcast |

> `RACE_LAP_COUNT_DEFAULT` is a fallback. Per-race lap count is defined in `data/schedule.json`.

> Tick count is no longer fixed — it is determined by the physics simulation. Cars
> accelerate/brake through the speed profile and the race ends when all cars finish
> (or after `TRAILING_GRACE_TICKS` following the leader). Duration scales naturally
> with track length and lap count.

## Physics simulation

| Constant | File | Default | Purpose |
|----------|------|---------|---------|
| `TILE_FEET` | `backend/config.py` | `30.0` | Real-world length of one track tile |
| `TOP_SPEED_MPH` | `backend/config.py` | `120.0` | Max speed on straights |
| `CORNER_SPEED_MPH` | `backend/config.py` | `60.0` | Target speed through curves |
| `CHICANE_SPEED_MPH` | `backend/config.py` | `45.0` | Target speed through chicanes |
| `ACCEL_G` | `backend/config.py` | `0.5` | Acceleration in g-forces |
| `BRAKE_G` | `backend/config.py` | `1.0` | Braking in g-forces |
| `TRAILING_GRACE_TICKS` | `backend/config.py` | `160` | Ticks after leader finishes before race ends (~10s) |

The speed profile is computed per-track via `build_speed_profile()` in
`simulation/engine.py`. Iterative constraint passes ensure cars can physically
reach and brake from each tile's target speed. On tight tracks, cars never reach
top speed; on long-straight tracks, they hit 120 mph and brake hard into corners.

---

## Map size

| Constant | File | Default | Effect of increasing | Effect of decreasing |
|----------|------|---------|----------------------|----------------------|
| `TRACK_GRID_SIZE` | `backend/config.py` | `12` | Larger track area, more tiles | Tighter track |
| `TRACK_MIN_STEPS` | `backend/config.py` | `24` | Longer minimum loop before closing | Shorter loops allowed |
| `TRACK_MAX_RETRIES` | `backend/config.py` | `10` | More attempts before oval fallback | Faster fallback on hard grids |

> Rule of thumb: on very small grids (N < 8) the random walk may struggle to find
> a valid loop. Increase `TRACK_MAX_RETRIES` or lower `TRACK_MIN_STEPS` if fallbacks
> are too frequent.

---

## Tile rendering

### `TILE_SIZE`
**File:** `frontend/src/views/race.js` → `VIEWER_CONFIG.TILE_SIZE`
**Default:** `4.0` (world units per grid tile)

Scales every tile mesh and the CatmullRomCurve control points.
Increase → tiles appear larger on screen (camera must cover more world units).
Decrease → tiles appear smaller; car models may look oversized.

---

### `TILE_MAP`
**File:** `frontend/src/views/race.js` → `VIEWER_CONFIG.TILE_MAP`

Maps `"type/orientation"` strings to tile numbers in the Road_01 PNG set.
Change a value to swap which image is used for a given tile type without touching
any other code.

| Key | Default tile # |
|-----|---------------|
| `straight/horizontal` | 3 |
| `straight/vertical`   | 9 |
| `curve/NE`            | 2 |
| `curve/NW`            | 1 |
| `curve/SE`            | 5 |
| `curve/SW`            | 6 |
| `chicane/horizontal`  | 7 |
| `chicane/vertical`    | 8 |

---

### `TILE_ROAD_SET`
**File:** `frontend/src/views/race.js` → `VIEWER_CONFIG.TILE_ROAD_SET`
**Default:** `'Road_01'`

The PNG subdirectory prefix. Change to `'Road_02'` (if assets exist) to swap the
entire tileset in one edit.

---

### `TILE_ROTATION`
**File:** `frontend/src/views/race.js` → `VIEWER_CONFIG.TILE_ROTATION`

Y-axis rotation (radians) applied to each tile mesh when placed flat.
Adjust individual entries if a tile appears rotated incorrectly on screen.

| Key | Default (radians) |
|-----|-------------------|
| `straight/horizontal` | `0` |
| `straight/vertical`   | `π/2` |
| `curve/NE`            | `0` |
| `curve/NW`            | `π/2` |
| `curve/SE`            | `-π/2` |
| `curve/SW`            | `π` |
| `chicane/horizontal`  | `0` |
| `chicane/vertical`    | `π/2` |

---

## Car appearance

| Constant | File | Default | Effect of increasing | Effect of decreasing |
|----------|------|---------|----------------------|----------------------|
| `CAR_SCALE` | `VIEWER_CONFIG` in `race.js` | `0.9` | Car appears larger | Car appears smaller |
| `CAR_Y` | `VIEWER_CONFIG` in `race.js` | `0.5` | Car floats higher above track | Car clips into track surface |

---

## Camera

| Constant | File | Default | Effect of increasing | Effect of decreasing |
|----------|------|---------|----------------------|----------------------|
| `CAM_FRUSTUM_HALF` | `VIEWER_CONFIG` in `race.js` | `15` | Zooms out (more world visible) | Zooms in (fewer tiles visible) |
| `CAM_OFFSET` | `VIEWER_CONFIG` in `race.js` | `{x:9, y:9, z:9}` | Camera farther from leader (more track visible) | Closer, tighter follow |
| `CAM_LERP` | `VIEWER_CONFIG` in `race.js` | `0.12` | Camera snaps to leader faster | Slower, more cinematic pan |

`CAM_FRUSTUM_HALF` is the orthographic camera's half-height in world units.
The horizontal extent is `CAM_FRUSTUM_HALF × aspect_ratio`.
At `TILE_SIZE = 4.0` a value of `15` shows roughly 7–8 tiles top-to-bottom.

The camera's isometric orientation (quaternion) is set once at init and never
changes — only `camera.position` is lerped each frame. There is no separate
look-target lerp.

> `CAM_LERP` is in [0, 1]. `0` = camera never moves; `1` = camera teleports each frame.

---

## Movement smoothing

| Constant | File | Default | Effect of increasing | Effect of decreasing |
|----------|------|---------|----------------------|----------------------|
| `LERP_SPEED` | `VIEWER_CONFIG` in `race.js` | `0.25` | Cars snap to tick position faster | Laggy / floaty movement |
| `ROT_SLERP` | `VIEWER_CONFIG` in `race.js` | `0.45` | Cars turn faster (snappier steering) | Slow, boat-like rotation |

Each frame, every car's render position moves toward its tick target by
`gap × LERP_SPEED`. This reaches the target in roughly 4–5 frames at 60 fps.

---

## Visual laps

Visual laps now equal the actual lap count — there is no cap. The physics-based tick
stream drives cars at realistic speeds, so each visual lap takes a physically correct
amount of time (depending on track length and cornering). The HUD shows
"Lap N / {lap_count}" and increments as the car completes each loop on screen.

Race duration scales naturally: a 25-lap sprint on a small track takes ~4 minutes,
while a 250-lap endurance race on a large track can take ~3 hours.

---

## Curve lookup table (internal)

The track's `CatmullRomCurve3` has its `arcLengthDivisions` set to
`pts.length × 10` before sampling (Three.js defaults to 200, which is far too
coarse for large tracks — a 132-tile track gets only 1.5 samples per segment,
causing visibly non-uniform spacing from `getPointAt()`). The curve is then
pre-sampled into a lookup table of 512 evenly spaced entries when the track is
built. Each entry stores 6 flat numbers
(`{ px, py, pz, tx, ty, tz }`) — position and tangent without `Vector3` wrappers.
Per-frame car positioning uses index lookup + inlined linear interpolation
(no `lerpVectors()` calls, zero allocations) instead of evaluating the curve
directly. This is not a tunable constant — it is an internal optimisation that
eliminates expensive `getPoint()`/`getTangent()` calls and per-frame object
allocation from the animation loop.
