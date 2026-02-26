# CarRacingSim

A browser-based car racing management game. Build your car from six part slots, enter scheduled races, and watch them play out in a live isometric 3D viewer. All races are shared broadcasts — every spectator sees the same event in real time.

## Quickstart

```bash
# Backend (Python 3.11+)
pip install -e ".[dev]"
uvicorn backend.main:app --reload

# Frontend (Node 18+, separate terminal)
cd frontend
npm install
npm run dev
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173` (Vite proxies `/api` and `/ws` to the backend)

On first run the backend creates `data/players/` and `data/races/`, reads `data/schedule.json`, and registers today's and tomorrow's races automatically.

## How It Works

1. **Register & log in** — JWT auth via httpOnly cookies
2. **Manage your car** (`#/garage`) — six slots (engine, tires, suspension, aero, fuel, electronics), three tier levels, wear and repair
3. **Enter races** (`#/schedule`) — 144 fixed daily slots, 8 event types, 100 cr entry fee
4. **Watch live** (`#/race/watch`) — isometric Three.js viewer driven by a physics-based WebSocket tick stream (duration scales with lap count: ~4 min sprint to ~3 hrs endurance)
5. **Review results** (`#/results`) — per-slot breakdown, formula components, counterfactual analysis

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + APScheduler + PyJWT + bcrypt + Pydantic v2 |
| Storage | JSON files (no database) |
| Frontend | Vite + Vanilla JS + Tailwind CSS + Three.js |
| Auth | httpOnly cookie JWT |
| Real-time | FastAPI WebSockets with in-memory fan-out |

## Project Structure

```
CarRacingSim/
├── pyproject.toml               # Python package definition
├── car.glb                      # 3D car model (served at /static/car.glb)
│
├── backend/
│   ├── config.py                # ALL tunable constants
│   ├── models.py                # Pydantic models
│   ├── storage.py               # JSON file I/O with asyncio.Lock
│   ├── auth.py                  # JWT + bcrypt auth
│   ├── main.py                  # FastAPI app, routes, WebSocket
│   ├── track_gen.py             # Random-walk track generator
│   ├── bots.py                  # Bot player generation (fills grids)
│   ├── simulation/engine.py     # Pure sim: performance formula, tick stream, wear
│   ├── broadcast/race_broadcaster.py  # In-memory fan-out
│   └── scheduler/jobs.py        # APScheduler: lock, run, reward
│
├── frontend/
│   ├── package.json / vite.config.js / tailwind.config.js
│   └── src/
│       ├── main.js              # Boot + auth check
│       ├── api.js               # fetch wrapper (credentials: include)
│       ├── router.js            # Hash-based router
│       └── views/
│           ├── auth.js          # Login / register
│           ├── schedule.js      # Race schedule grid
│           ├── garage.js        # Car management
│           ├── race.js          # Three.js isometric viewer
│           └── results.js       # Post-race breakdown
│
├── data/
│   ├── schedule.json            # 144 slots (event_type, lap_count, grid_size)
│   ├── players/{id}.json        # Per-player state
│   └── races/{YYYY-MM-DD_HH:MM}.json
│
├── docs/                        # Design and technical documentation
│   ├── api.md                   # API route reference
│   ├── event_types.md           # 8 event types and their mechanics
│   ├── gameplay_loop.md         # Core loop: prep → race → review
│   ├── maintenance.md           # Operations guide
│   ├── mechanics.md             # Performance formula and scoring
│   ├── schedule.md              # Schedule structure and cadence
│   ├── stack.md                 # Architecture and tech choices
│   ├── systems.md               # Cars, tiers, economy, progression
│   └── viewer_config.md         # Tunable viewer/simulation constants
│
└── PNG/                         # Tile assets (served at /static/PNG/...)
    ├── Road_01/Road_01_Tile_NN/
    └── Background_Tiles/Grass_Tile.png
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SECRET_KEY` | `dev-secret-change-in-production` | JWT signing key |

## Documentation

All design and technical docs live in [`docs/`](docs/):

- **[api.md](docs/api.md)** — HTTP and WebSocket API reference
- **[mechanics.md](docs/mechanics.md)** — Performance formula, luck, scoring
- **[event_types.md](docs/event_types.md)** — All 8 event types and their effects
- **[systems.md](docs/systems.md)** — Cars, tiers, economy, progression
- **[schedule.md](docs/schedule.md)** — Race schedule structure
- **[gameplay_loop.md](docs/gameplay_loop.md)** — Core game loop
- **[stack.md](docs/stack.md)** — Architecture and technology choices
- **[viewer_config.md](docs/viewer_config.md)** — Tunable constants reference
- **[maintenance.md](docs/maintenance.md)** — Operations, setup, troubleshooting

## Status

Alpha build. All code written, not yet run or installed.
