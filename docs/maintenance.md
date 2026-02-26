# Maintenance & Operations Guide

This is the single reference for understanding how CarRacingSim is organized, what it requires to run, and how to update or extend any part of it.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Requirements](#2-requirements)
3. [Running the Project](#3-running-the-project)
4. [How the Systems Connect](#4-how-the-systems-connect)
5. [Updating the Schedule](#5-updating-the-schedule)
6. [Updating Game Constants](#6-updating-game-constants)
7. [Adding a New Event Type](#7-adding-a-new-event-type)
8. [Resetting Game Data](#8-resetting-game-data)
9. [Updating the Frontend Viewer](#9-updating-the-frontend-viewer)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Project Structure

```
CarRacingSim/
│
├── pyproject.toml               # Python package definition; pip install -e .
│
├── backend/
│   ├── config.py                # ALL tunable constants — edit here first
│   ├── models.py                # Pydantic data models: Player, Race, CarSlots, etc.
│   ├── storage.py               # JSON file I/O; asyncio.Lock per file
│   ├── auth.py                  # JWT creation/verification; bcrypt password hashing
│   ├── main.py                  # FastAPI app, all HTTP routes, WebSocket endpoint
│   │
│   ├── track_gen.py             # Random-walk track generator → TrackData
│   ├── bots.py                  # Bot player generation (fills race grids)
│   │
│   ├── simulation/
│   │   └── engine.py            # Pure simulation: simulate_race(), generate_tick_stream(), apply_wear()
│   │
│   ├── broadcast/
│   │   └── race_broadcaster.py  # In-memory fan-out: race_id → list[asyncio.Queue]
│   │
│   └── scheduler/
│       └── jobs.py              # APScheduler jobs: lock entries, run race, apply rewards/wear
│
├── frontend/
│   ├── package.json             # Node dependencies
│   ├── vite.config.js           # Dev server + /api proxy to localhost:8000
│   ├── tailwind.config.js       # Tailwind theme (track-bg, track-accent, etc.)
│   └── src/
│       ├── main.js              # Boot: auth check, route wiring
│       ├── api.js               # fetch() wrapper with credentials:include
│       ├── router.js            # Hash-based router (#/schedule, #/garage, etc.)
│       └── views/
│           ├── auth.js          # Login / register form
│           ├── schedule.js      # 144-slot schedule grid; enter/withdraw buttons
│           ├── garage.js        # 6-slot car management; repair/swap UI
│           ├── race.js          # Three.js isometric viewer + WebSocket + HUD
│           └── results.js       # Post-race breakdown: per-slot, formula, counterfactual
│
├── data/
│   ├── schedule.json            # 144 time slots × (event_type, lap_count, grid_size)
│   ├── players/                 # One JSON file per registered player
│   └── races/                   # One JSON file per race (auto-created on startup)
│
├── docs/                        # All design and technical documentation
│
├── car.glb                      # 3D car model served at /static/car.glb
│
└── PNG/
    ├── Road_01/                 # Road tile images (Road_01_Tile_01 … Road_01_Tile_08)
    │   └── Road_01_Tile_NN/
    │       └── Road_01_Tile_NN.png
    └── Background_Tiles/
        └── Grass_Tile.png
```

### Key files at a glance

| File | What to edit it for |
|------|---------------------|
| `backend/config.py` | Any numeric constant: lap counts, wear rates, rewards, costs |
| `data/schedule.json` | Race cadence, event sequence, per-race lap count, per-race grid size |
| `backend/models.py` | Adding fields to Player, Race, or CarSlots |
| `backend/simulation/engine.py` | Changing the performance formula or wear logic |
| `backend/track_gen.py` | Track generation algorithm or tile classification |
| `frontend/src/views/race.js` | `VIEWER_CONFIG` — camera, tile rendering, car scale |
| `tailwind.config.js` | UI colour palette |

---

## 2. Requirements

### Backend (Python)

- **Python 3.11+**
- Dependencies defined in `pyproject.toml`:

```toml
[project.dependencies]
fastapi
uvicorn[standard]
apscheduler
pyjwt
passlib[bcrypt]
pydantic>=2
```

Install with:
```bash
pip install -e ".[dev]"
```

No database is required. All state is stored as plain JSON files in `data/`.

### Frontend (Node)

- **Node 18+** (any recent LTS)
- Dependencies defined in `frontend/package.json`:
  - `vite` — dev server and bundler
  - `three` — 3D scene rendering
  - `tailwindcss` — utility CSS

Install with:
```bash
cd frontend && npm install
```

### Environment variable

| Variable | Default | Purpose |
|----------|---------|---------|
| `SECRET_KEY` | `dev-secret-change-in-production` | JWT signing key — **set this in production** |

---

## 3. Running the Project

### Development (two terminals)

```bash
# Terminal 1 — backend
pip install -e ".[dev]"
uvicorn backend.main:app --reload

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173` (Vite proxy forwards `/api` and `/ws` to backend)

### First run

On startup, `backend/main.py` calls `ensure_dirs()` which creates `data/players/` and `data/races/` if they do not exist. The scheduler then reads `data/schedule.json` and creates race JSON files for today and tomorrow. No manual setup required beyond installing dependencies.

### What happens on startup

1. `ensure_dirs()` creates missing data directories
2. `setup_scheduler()` reads `data/schedule.json`
3. For every future slot today and tomorrow, `ensure_race_exists()` creates a race file if one doesn't exist yet — reading `lap_count` and `grid_size` from the slot definition
4. APScheduler registers two jobs per race: `lock_{race_id}` at T−10 min, `run_{race_id}` at T+0
5. A `midnight_refresh` cron job re-registers the next day's races at 00:00:05 UTC each night

### Production notes

- Set `SECRET_KEY` environment variable before starting
- Build the frontend: `cd frontend && npm run build`
- Serve the built files with FastAPI's `StaticFiles` or nginx
- The backend process must stay running for the scheduler to fire; use systemd, Docker, or a process manager

---

## 4. How the Systems Connect

### Data flow for a race

```
data/schedule.json
       │  (on startup or midnight)
       ▼
scheduler/jobs.py :: ensure_race_exists()
       │  generates track, writes race JSON
       ▼
data/races/{YYYY-MM-DD_HH:MM}.json   ←── players enter via POST /api/races/{id}/enter
       │
       │  at T−10 min
       ▼
scheduler/jobs.py :: lock_race_entries()
       │  snapshots each entrant's current car into locked_car
       ▼
       │  at T+0
       ▼
scheduler/jobs.py :: run_race_job()
       │
       ├──► simulation/engine.py :: simulate_race(race)
       │         reads locked_car builds, returns EntryResult list
       │
       ├──► simulation/engine.py :: generate_tick_stream(results, lap_count, track)
       │         yields physics-based tick stream (generator, variable length)
       │
       ├──► broadcast/race_broadcaster.py :: broadcast(race_id, tick)
       │         pushes each tick to all subscribers (WebSocket clients)
       │
       ├──► data/races/{id}.json   (status → "finished", results saved)
       │
       └──► data/players/{id}.json (credits + wear applied per entrant)
```

### WebSocket flow (frontend)

```
frontend (race.js)
    │  connects to WS /ws/races/{race_id}
    │
    ▼
main.py :: ws_race()
    │  sends race_init (track, entrants, lap_count, your_id)
    │  subscribes client queue to broadcaster
    │
    ▼  (each tick from scheduler)
broadcaster → queue → ws_race() → websocket.send_json(tick)
    │
    ▼
race.js :: tick handler
    ├── updates carTargetProgress[car_id]
    ├── updateLeaderboard(msg.cars)
    └── updateMySpeed(msg.cars)
```

### Module dependency rules

- `simulation/engine.py` has **no I/O** — pure functions only; testable in isolation
- `scheduler/jobs.py` is the **only writer** for race results; no other code writes to `data/races/`
- `broadcast/race_broadcaster.py` is **stateless except for the in-memory queues** — restarting the server drops all live connections

---

## 5. Updating the Schedule

The schedule is defined entirely in `data/schedule.json`. The backend reads it on startup (and at midnight each night). **You do not need to touch Python code to change the schedule.**

### File structure

```json
{
  "cadence_note": "human-readable description",
  "event_types": ["sprint", "endurance", ...],
  "slots": [
    { "time": "HH:MM", "event_type": "sprint", "lap_count": 25, "grid_size": 12 },
    ...
  ]
}
```

### To change the race cadence

Re-generate `data/schedule.json` with a different time step. Example: change every-10-minutes to every-15-minutes:

```python
# run this script, pipe output to data/schedule.json
for i in range(96):          # 24h × 60min / 15min = 96 slots
    minute_offset = i * 15
    hour, minute = divmod(minute_offset, 60)
    time_str = f"{hour:02d}:{minute:02d}"
    # ... assign event_type, lap_count, grid_size
```

After regenerating, delete existing race files and restart the backend:

```bash
rm data/races/*.json
# restart uvicorn
```

### To change lap counts

Edit the `lap_count` value for any slot directly in `data/schedule.json`. Valid range: any positive integer. The value is stored in `Race.lap_count` when the race is created and used by both the simulation engine and the WebSocket broadcast. After editing:

```bash
rm data/races/*.json   # clear stale races with old lap counts
# restart uvicorn
```

### To change grid sizes

Edit the `grid_size` value for any slot. Valid range: **4–60** (the oval fallback requires N ≥ 4; above 60 the track generation is slow). The track for each race is generated when the race file is first created, so changes only affect future races. After editing:

```bash
rm data/races/*.json
# restart uvicorn
```

### Schedule design constraint

No two adjacent slots should share the same `event_type`. The current schedule uses a step-3 cycle through 8 event types (`EVENTS[(i * 3) % 8]`) which guarantees this. If you add or remove event types, verify adjacency manually or re-run the generation script.

---

## 6. Updating Game Constants

All numeric constants live in `backend/config.py`. Changes take effect on the next server restart.

### Sections and what to change

| Section | Constants | When to change |
|---------|-----------|----------------|
| **Economy** | `STARTING_CREDITS`, `STARTING_MATERIALS`, `ENTRY_FEE`, `FINISH_REWARDS`, `DEFAULT_REWARD` | Rebalancing the credit economy |
| **Car / parts** | `TIER_SCORES`, `TIER_UNLOCK_RACES`, `SLOT_SWAP_COSTS`, `SLOT_WEIGHT_UNITS`, `WEIGHT_LIMIT` | Changing tier progression or part costs |
| **Wear** | `BASE_WEAR_PCT`, `WEAR_MULTIPLIERS`, `EVENT_STRESSED_SLOTS` | Making events harder/easier on parts |
| **Simulation weights** | `EVENT_SLOT_WEIGHTS` | Changing which slots matter for which events |
| **Race broadcast** | `RACE_TICK_INTERVAL_MS` | Changing broadcast tick rate |
| **Physics** | `TILE_FEET`, `TOP_SPEED_MPH`, `CORNER_SPEED_MPH`, `CHICANE_SPEED_MPH`, `ACCEL_G`, `BRAKE_G`, `TRAILING_GRACE_TICKS` | Tuning car physics and race duration |
| **Track generation** | `TRACK_GRID_SIZE`, `TRACK_MIN_STEPS`, `TRACK_MAX_RETRIES` | Fallback default grid size; retry budget |

### Lap count and grid size

These are **not** in `config.py` — they live in `data/schedule.json` per slot and are stored on each `Race` object. The defaults `RACE_LAP_COUNT_DEFAULT = 25` and `TRACK_GRID_SIZE = 12` in `config.py` are fallbacks used only when creating a race outside the normal scheduler flow (e.g. the admin start-race endpoint without a matching schedule slot).

### Broadcast timing

Race duration is determined by physics simulation — tick count is variable and depends
on track length, lap count, and car speeds. `RACE_TICK_INTERVAL_MS` (default 62ms,
~16 ticks/sec) controls only the wall-clock pace of the broadcast. Duration scales
naturally: ~4 minutes for a 25-lap sprint, up to ~3 hours for a 250-lap endurance race.

---

## 7. Adding a New Event Type

Adding an event type requires touching five places:

### Step 1 — `backend/config.py`

Add entries for the new type in all four event dictionaries:

```python
WEAR_MULTIPLIERS["new_event"] = 1.0

EVENT_STRESSED_SLOTS["new_event"] = ["engine"]  # or [] for no stressed slot

EVENT_SLOT_WEIGHTS["new_event"] = {
    "engine": 1.0, "tires": 1.0, "suspension": 1.0,
    "aero": 1.0, "fuel": 1.0, "electronics": 1.0,
}
```

### Step 2 — `backend/simulation/engine.py`

If the new event has a special penalty (like `wet_track`'s Standard Tires check), add it to the `_event_fit()` function's penalty block:

```python
elif event_type == "new_event":
    if car.engine.tier == "standard":
        penalty += 10.0
```

### Step 3 — `data/schedule.json`

Add the new event type to the `event_types` list and assign it to slots. Remember: no two adjacent slots should share the same type.

### Step 4 — `docs/event_types.md`

Add a section describing the new event's format, mechanics, and build advice visible to players.

### Step 5 — Delete stale race files and restart

```bash
rm data/races/*.json
# restart uvicorn
```

---

## 8. Resetting Game Data

### Delete all races (keep players)

```bash
rm data/races/*.json
```

The scheduler recreates race files for today and tomorrow on the next startup.

### Delete all player accounts

```bash
rm data/players/*.json
```

All players will need to re-register. Player UUIDs will be new, so old race entries referencing old player IDs become orphaned (harmless — the race files themselves are also typically reset).

### Full reset

```bash
rm data/races/*.json data/players/*.json
```

After a full reset, restart the backend. The schedule is preserved; only runtime game state is wiped.

### Deleting specific race files

Race files are named `YYYY-MM-DD_HH:MM.json` matching the slot time in UTC. To remove a specific race:

```bash
rm "data/races/2026-02-25_14:30.json"
```

The scheduler will recreate it with a fresh track on the next startup (if the slot is in today's or tomorrow's schedule).

---

## 9. Updating the Frontend Viewer

All viewer tuning lives in `VIEWER_CONFIG` at the top of `frontend/src/views/race.js`. See `docs/viewer_config.md` for a full reference of every constant.

### Most common adjustments

| Goal | Constant | File |
|------|----------|------|
| Zoom in / out | `CAM_FRUSTUM_HALF` | `race.js` VIEWER_CONFIG |
| Move camera further from leader | `CAM_OFFSET` | `race.js` VIEWER_CONFIG |
| Make cars bigger / smaller | `CAR_SCALE` | `race.js` VIEWER_CONFIG |
| Make car movement smoother | `LERP_SPEED` | `race.js` VIEWER_CONFIG |
| Swap tile image set | `TILE_ROAD_SET` | `race.js` VIEWER_CONFIG |
| Change tile size in world units | `TILE_SIZE` | `race.js` VIEWER_CONFIG |

### Adding a new tile image set

1. Place PNG files in `PNG/Road_02/Road_02_Tile_NN/Road_02_Tile_NN.png`
2. Set `TILE_ROAD_SET: 'Road_02'` in `VIEWER_CONFIG`
3. The backend serves all files under `PNG/` at `/static/PNG/…` automatically

### Changing the colour palette

Edit `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      'track-bg':    '#0f1117',
      'track-accent': '#e8c84a',
      'track-muted':  '#6b7280',
    }
  }
}
```

Run `npm run dev` (or `npm run build`) to apply.

---

## 10. Troubleshooting

### Races not appearing after startup

The scheduler only creates races for today and tomorrow. If the server was started at midnight and `data/schedule.json` was edited, delete race files and restart:

```bash
rm data/races/*.json && uvicorn backend.main:app --reload
```

### Race viewer shows wrong lap count

The `lap_count` is baked into the race JSON when `ensure_race_exists()` runs. If you changed `data/schedule.json` without deleting old race files, the existing files still carry the old value. Delete race files and restart.

### Track generation falls back to oval

The random-walk generator retries up to `TRACK_MAX_RETRIES` (default 10) times. If every attempt fails, it uses the oval fallback. This is most likely on very small grids (N < 8) or if `TRACK_MIN_STEPS` is set higher than the grid can support. Lower `TRACK_MIN_STEPS` or increase N in the relevant schedule slots.

### WebSocket disconnects immediately

Usually a CORS or cookie issue. Check that:
- Backend CORS `allow_origins` includes the frontend origin (`http://localhost:5173` in dev)
- The `session` cookie is set (player must be logged in)
- The backend is running and reachable at `localhost:8000`

### Player credits go negative

The entry fee is deducted on entry and there is no check against a running total before deduction. If needed, add a `credits >= entry_fee` guard in `backend/main.py :: enter_race()`. The check is already there — if it triggers, the player's `STARTING_CREDITS` in `config.py` may be too low relative to `ENTRY_FEE`.

### Frontend changes not visible

Vite's HMR covers most cases. If a change is not reflected:
```bash
# hard restart the dev server
cd frontend && npm run dev
```
For production builds, always run `npm run build` before restarting the FastAPI server.
