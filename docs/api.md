# API Reference

All HTTP routes are served at `http://localhost:8000`. The frontend dev server
(Vite, port 5173) proxies `/api` and `/ws` to the backend automatically.

Authentication uses an httpOnly cookie named `session` containing a JWT.
Routes marked **Auth required** return 401 if the cookie is missing or expired.

---

## Table of Contents

1. [Auth](#auth)
2. [Schedule & Races](#schedule--races)
3. [Car Management](#car-management)
4. [Race Entry](#race-entry)
5. [Admin](#admin)
6. [WebSocket — Live Race](#websocket--live-race)
7. [Static Assets](#static-assets)

---

## Auth

### `POST /api/auth/register`

Create a new player account and set the session cookie.

**Body:**
```json
{ "username": "string (≥3 chars)", "password": "string (≥6 chars)" }
```

**Response 200:**
```json
{ "id": "uuid", "username": "string" }
```

**Errors:** `400` validation, `409` username taken.
Sets `session` httpOnly cookie (30-day expiry).

---

### `POST /api/auth/login`

Log in with existing credentials.

**Body:**
```json
{ "username": "string", "password": "string" }
```

**Response 200:**
```json
{ "id": "uuid", "username": "string" }
```

**Errors:** `401` invalid credentials.
Sets `session` httpOnly cookie (30-day expiry).

---

### `POST /api/auth/logout`

Clear the session cookie.

**Response 200:**
```json
{ "ok": true }
```

---

### `GET /api/auth/me`

**Auth required.** Return the current player's profile summary.

**Response 200:**
```json
{
  "id": "uuid",
  "username": "string",
  "credits": 5000,
  "materials": 10,
  "races_entered": 0
}
```

---

## Schedule & Races

### `GET /api/schedule`

**Auth required.** List all races for today and tomorrow.

**Response 200:** array of:
```json
{
  "id": "2026-02-26_14:30",
  "scheduled_time": "2026-02-26T14:30:00+00:00",
  "event_type": "sprint",
  "status": "open",
  "entry_fee": 100,
  "lap_count": 25,
  "grid_size": 12,
  "entrant_count": 3,
  "entered": false
}
```

`entered` is `true` if the authenticated player is in this race's entry list.

---

### `GET /api/races/{race_id}`

**Auth required.** Get full race details.

**Path params:** `race_id` — e.g. `"2026-02-26_14:30"`

**Response 200:** Full `Race` object. The `results` field is excluded unless
`status` is `"finished"`.

```json
{
  "id": "2026-02-26_14:30",
  "scheduled_time": "2026-02-26T14:30:00+00:00",
  "event_type": "sprint",
  "status": "open",
  "entry_fee": 100,
  "lap_count": 25,
  "grid_size": 12,
  "track": {
    "grid_width": 6,
    "grid_height": 6,
    "tiles": [{ "x": 0, "y": 0, "type": "straight", "orientation": "horizontal" }],
    "path_order": [[0, 0], [1, 0]]
  },
  "entries": [{
    "player_id": "uuid",
    "username": "string",
    "locked_car": null,
    "entered_at": "2026-02-26T14:00:00+00:00"
  }],
  "results": []
}
```

**Errors:** `404` race not found.

---

## Car Management

### `GET /api/car`

**Auth required.** Get the player's current car state with per-slot details.

**Response 200:**
```json
{
  "slots": {
    "engine": {
      "tier": "standard",
      "readiness": 85.0,
      "tier_score": 40,
      "swap_cost": { "time_min": 20, "credits": 800, "materials": 2 }
    },
    "tires": { "..." },
    "suspension": { "..." },
    "aero": { "..." },
    "fuel": { "..." },
    "electronics": { "..." }
  },
  "credits": 5000,
  "materials": 10,
  "races_entered": 0,
  "tier_unlocks": {
    "upgraded": false,
    "performance": false
  }
}
```

---

### `POST /api/car/repair/{slot}`

**Auth required.** Repair a slot to 100% readiness. Costs 1 material.

**Path params:** `slot` — one of `engine`, `tires`, `suspension`, `aero`, `fuel`, `electronics`

**Response 200:**
```json
{ "slot": "engine", "readiness": 100.0, "materials": 9 }
```

**Errors:** `400` unknown slot, not enough materials, already at full readiness.

---

### `POST /api/car/swap/{slot}`

**Auth required.** Install a different tier part in a slot. Resets readiness to 100%.

**Path params:** `slot` — one of `engine`, `tires`, `suspension`, `aero`, `fuel`, `electronics`

**Body:**
```json
{ "tier": "upgraded" }
```

**Response 200:**
```json
{
  "slot": "engine",
  "tier": "upgraded",
  "credits": 4200,
  "materials": 8
}
```

**Errors:** `400` unknown slot/tier, not enough credits/materials, tier not unlocked.

---

## Race Entry

### `POST /api/races/{race_id}/enter`

**Auth required.** Enter a race. Deducts the entry fee from player credits.

**Path params:** `race_id` — e.g. `"2026-02-26_14:30"`

**Response 200:**
```json
{ "entered": true, "credits": 4900, "entry_fee": 100 }
```

**Errors:** `404` race not found, `400` race not open or insufficient credits, `409` already entered.

---

### `DELETE /api/races/{race_id}/enter`

**Auth required.** Withdraw from a race. Refunds 50% of the entry fee.

**Path params:** `race_id` — e.g. `"2026-02-26_14:30"`

**Response 200:**
```json
{ "withdrawn": true, "refund": 50, "credits": 4950 }
```

**Errors:** `404` race not found, `400` race not open or not entered.

---

## Admin

Admin routes require the authenticated user to have the username `"admin"`.

### `POST /api/admin/races/{race_id}/start`

Manually start a race (skip the scheduler). Useful for testing.

**Path params:** `race_id`

**Response 200:**
```json
{ "started": true, "race_id": "2026-02-26_14:30" }
```

**Errors:** `403` not admin, `404` race not found, `400` already running or finished.

---

### `POST /api/admin/reset-schedule`

Delete all existing race files and re-create them from `data/schedule.json`.

**Response 200:**
```json
{ "reset": true, "races_created": 144 }
```

**Errors:** `403` not admin.

---

## WebSocket — Live Race

### `WS /ws/races/{race_id}`

Connect to a live race broadcast. Auth is optional — the `session` cookie is read
to identify the player (sets `your_id` in the init message) but unauthenticated
connections are allowed for spectating.

### Message types (server → client)

**`race_init`** — sent immediately on connect:
```json
{
  "type": "race_init",
  "race_id": "2026-02-26_14:30",
  "event_type": "sprint",
  "status": "open",
  "track": { "grid_width": 6, "grid_height": 6, "tiles": [], "path_order": [] },
  "entrants": [{ "car_id": "uuid", "username": "player1" }],
  "your_id": "uuid-or-null",
  "lap_count": 25
}
```

**`status`** — race status changed:
```json
{ "type": "status", "status": "running" }
```

**`tick`** — position update (300 per race, every 250ms):
```json
{
  "type": "tick",
  "tick": 1,
  "lap_count": 25,
  "cars": [{
    "car_id": "uuid",
    "username": "player1",
    "progress": 0.034,
    "speed": 87.5,
    "incident": null
  }]
}
```

`progress` is 0–1 across the entire race. `incident` is `null`, `"dnf_start"`,
or other incident strings.

**`finished`** — race complete, includes full results:
```json
{
  "type": "finished",
  "results": [{
    "player_id": "uuid",
    "username": "player1",
    "position": 1,
    "result_score": 78.3,
    "build_quality": 70.0,
    "event_fit": 82.5,
    "readiness_score": 91.0,
    "luck_delta": 3.2,
    "counterfactual_position": 2,
    "per_slot": {},
    "luck_tag": "lucky",
    "dnf": false,
    "dnf_slot": null
  }]
}
```

**`ping`** — keepalive (every 60s if no other messages):
```json
{ "type": "ping" }
```

**`error`** — sent if the race is not found:
```json
{ "type": "error", "detail": "Race not found" }
```

### Late joiners

If a client connects to a race that is already `"finished"`, the server sends
`race_init` followed by `finished` and then closes the connection. If the race
is `"running"`, the client receives ticks from the current point onward (no
replay of past ticks).

---

## Static Assets

| URL | Description |
|-----|-------------|
| `GET /static/car.glb` | 3D car model (GLTF binary) |
| `GET /static/PNG/{set}/{set}_Tile_{NN}/{set}_Tile_{NN}.png` | Road tile images |
| `GET /static/PNG/Background_Tiles/Grass_Tile.png` | Grass background tile |

The `{set}` is the tile road set name (default `Road_01`). `{NN}` is the
zero-padded tile number (e.g. `01`, `09`).
