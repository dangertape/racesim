"""
FastAPI application entry point.

Routes:
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/logout
  GET  /api/auth/me

  GET  /api/schedule
  GET  /api/races/{race_id}

  GET  /api/car
  POST /api/car/repair/{slot}
  POST /api/car/swap/{slot}

  POST   /api/races/{race_id}/enter
  DELETE /api/races/{race_id}/enter   (withdraw)

  POST /api/admin/races/{race_id}/start
  POST /api/admin/reset-schedule

  WS   /ws/races/{race_id}

Static:
  /static/PNG/  → PNG tile assets
  /static/car.glb

See docs/api.md for full request/response documentation.
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    Cookie, Depends, FastAPI, HTTPException, Response, WebSocket,
    WebSocketDisconnect, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.auth import (
    create_token, decode_token, get_current_player,
    hash_password, verify_password,
)
from backend.broadcast.race_broadcaster import broadcaster
from backend.config import (
    CAR_GLB, ENTRY_FEE, FINISH_REWARDS, SLOT_NAMES, SLOT_SWAP_COSTS,
    STATIC_DIR, TIER_SCORES, TIER_UNLOCK_RACES,
)
from backend.models import Player, Race, RaceEntry, SlotPart
from backend.scheduler.jobs import setup_scheduler, run_race_job, reset_schedule
from backend.storage import (
    ensure_dirs, find_player_by_username, load_player, load_race,
    list_races, save_player, save_race,
)

log = logging.getLogger("uvicorn.error")

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    app.state.scheduler = await setup_scheduler()
    yield
    app.state.scheduler.shutdown()


app = FastAPI(title="CarRacingSim", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files — PNG tile assets
app.mount("/static/PNG", StaticFiles(directory=str(STATIC_DIR)), name="png_tiles")


@app.get("/static/car.glb")
async def serve_car_glb():
    if not CAR_GLB.exists():
        raise HTTPException(404, "car.glb not found")
    return FileResponse(str(CAR_GLB), media_type="model/gltf-binary")


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterBody(BaseModel):
    username: str
    password: str


@app.post("/api/auth/register")
async def register(body: RegisterBody, response: Response):
    if len(body.username) < 3 or len(body.password) < 6:
        raise HTTPException(400, "Username ≥ 3 chars, password ≥ 6 chars")
    existing = await find_player_by_username(body.username)
    if existing:
        raise HTTPException(409, "Username taken")
    player = Player(username=body.username, hashed_password=hash_password(body.password))
    await save_player(player)
    token = create_token(player.id)
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 30)
    return {"id": player.id, "username": player.username}


@app.post("/api/auth/login")
async def login(body: RegisterBody, response: Response):
    player = await find_player_by_username(body.username)
    if not player or not verify_password(body.password, player.hashed_password):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(player.id)
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 30)
    return {"id": player.id, "username": player.username}


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(player: Player = Depends(get_current_player)):
    return {
        "id": player.id,
        "username": player.username,
        "credits": player.credits,
        "materials": player.materials,
        "races_entered": player.races_entered,
    }


# ── Schedule & races ──────────────────────────────────────────────────────────

@app.get("/api/schedule")
async def get_schedule(player: Player = Depends(get_current_player)):
    races = await list_races()
    entered_ids = set()
    for r in races:
        if any(e.player_id == player.id for e in r.entries):
            entered_ids.add(r.id)

    return [
        {
            "id": r.id,
            "scheduled_time": r.scheduled_time,
            "event_type": r.event_type,
            "status": r.status,
            "entry_fee": r.entry_fee,
            "lap_count": r.lap_count,
            "grid_size": r.grid_size,
            "entrant_count": len(r.entries),
            "entered": r.id in entered_ids,
        }
        for r in races
    ]


@app.get("/api/races/{race_id}")
async def get_race(race_id: str, player: Player = Depends(get_current_player)):
    race = await load_race(race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    return race.model_dump(exclude={"results"} if race.status != "finished" else set())


# ── Car management ────────────────────────────────────────────────────────────

@app.get("/api/car")
async def get_car(player: Player = Depends(get_current_player)):
    slots = {}
    for s in SLOT_NAMES:
        part = player.car.get_slot(s)
        cost = SLOT_SWAP_COSTS[s]
        slots[s] = {
            "tier": part.tier,
            "readiness": part.readiness,
            "tier_score": TIER_SCORES[part.tier],
            "swap_cost": cost,
        }
    return {
        "slots": slots,
        "credits": player.credits,
        "materials": player.materials,
        "races_entered": player.races_entered,
        "tier_unlocks": {
            "upgraded": player.races_entered >= TIER_UNLOCK_RACES["upgraded"],
            "performance": player.races_entered >= TIER_UNLOCK_RACES["performance"],
        },
    }


@app.post("/api/car/repair/{slot}")
async def repair_slot(slot: str, player: Player = Depends(get_current_player)):
    if slot not in SLOT_NAMES:
        raise HTTPException(400, f"Unknown slot: {slot}")
    if player.materials < 1:
        raise HTTPException(400, "Not enough materials (need 1)")
    part = player.car.get_slot(slot)
    if part.readiness >= 100:
        raise HTTPException(400, "Slot already at full readiness")
    player.car.set_slot(slot, part.model_copy(update={"readiness": 100.0}))
    player = player.model_copy(update={"materials": player.materials - 1})
    await save_player(player)
    return {"slot": slot, "readiness": 100.0, "materials": player.materials}


class SwapBody(BaseModel):
    tier: str


@app.post("/api/car/swap/{slot}")
async def swap_slot(slot: str, body: SwapBody, player: Player = Depends(get_current_player)):
    if slot not in SLOT_NAMES:
        raise HTTPException(400, f"Unknown slot: {slot}")
    if body.tier not in TIER_SCORES:
        raise HTTPException(400, f"Unknown tier: {body.tier}")
    required_races = TIER_UNLOCK_RACES[body.tier]
    if player.races_entered < required_races:
        raise HTTPException(400, f"{body.tier.title()} tier requires {required_races} races entered")
    cost = SLOT_SWAP_COSTS[slot]
    if player.credits < cost["credits"]:
        raise HTTPException(400, f"Not enough credits (need {cost['credits']})")
    if player.materials < cost["materials"]:
        raise HTTPException(400, f"Not enough materials (need {cost['materials']})")
    player.car.set_slot(slot, SlotPart(tier=body.tier, readiness=100.0))
    player = player.model_copy(update={
        "credits": player.credits - cost["credits"],
        "materials": player.materials - cost["materials"],
    })
    await save_player(player)
    return {
        "slot": slot,
        "tier": body.tier,
        "credits": player.credits,
        "materials": player.materials,
    }


# ── Race entry ────────────────────────────────────────────────────────────────

@app.post("/api/races/{race_id}/enter")
async def enter_race(race_id: str, player: Player = Depends(get_current_player)):
    race = await load_race(race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if race.status not in ("open",):
        raise HTTPException(400, f"Race is {race.status} — cannot enter")
    if any(e.player_id == player.id for e in race.entries):
        raise HTTPException(409, "Already entered")
    if player.credits < race.entry_fee:
        raise HTTPException(400, "Not enough credits for entry fee")
    player = player.model_copy(update={"credits": player.credits - race.entry_fee})
    await save_player(player)
    entry = RaceEntry(
        player_id=player.id,
        username=player.username,
        entered_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    race = race.model_copy(update={"entries": race.entries + [entry]})
    await save_race(race)
    return {"entered": True, "credits": player.credits, "entry_fee": race.entry_fee}


@app.delete("/api/races/{race_id}/enter")
async def withdraw_race(race_id: str, player: Player = Depends(get_current_player)):
    race = await load_race(race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if race.status != "open":
        raise HTTPException(400, f"Race is {race.status} — withdrawal no longer allowed")
    entry = next((e for e in race.entries if e.player_id == player.id), None)
    if not entry:
        raise HTTPException(400, "Not entered in this race")
    # Refund 50 % of entry fee
    refund = race.entry_fee // 2
    player = player.model_copy(update={"credits": player.credits + refund})
    await save_player(player)
    new_entries = [e for e in race.entries if e.player_id != player.id]
    race = race.model_copy(update={"entries": new_entries})
    await save_race(race)
    return {"withdrawn": True, "refund": refund, "credits": player.credits}


# ── Admin ─────────────────────────────────────────────────────────────────────

@app.post("/api/admin/races/{race_id}/start")
async def admin_start_race(race_id: str, player: Player = Depends(get_current_player)):
    if player.username != "admin":
        raise HTTPException(403, "Admin only")
    race = await load_race(race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if race.status == "finished":
        raise HTTPException(400, "Race already finished")
    if race.status == "running":
        raise HTTPException(400, "Race already running")
    asyncio.create_task(run_race_job(race_id))
    return {"started": True, "race_id": race_id}


@app.post("/api/admin/reset-schedule")
async def admin_reset_schedule(player: Player = Depends(get_current_player)):
    if player.username != "admin":
        raise HTTPException(403, "Admin only")
    created = await reset_schedule(app.state.scheduler)
    return {"reset": True, "races_created": created}


# ── WebSocket live race ───────────────────────────────────────────────────────

@app.websocket("/ws/races/{race_id}")
async def ws_race(websocket: WebSocket, race_id: str):
    session = websocket.cookies.get("session")
    player_id = decode_token(session) if session else None

    await websocket.accept()

    race = await load_race(race_id)
    if not race:
        await websocket.send_json({"type": "error", "detail": "Race not found"})
        await websocket.close()
        return

    # Send current race state to late joiners
    await websocket.send_json({
        "type": "race_init",
        "race_id": race_id,
        "event_type": race.event_type,
        "status": race.status,
        "track": race.track.model_dump() if race.track else None,
        "entrants": [{"car_id": e.player_id, "username": e.username} for e in race.entries],
        "your_id": player_id,
        "lap_count": race.lap_count,
    })

    if race.status == "finished":
        await websocket.send_json({
            "type": "finished",
            "results": [r.model_dump() for r in race.results],
        })
        await websocket.close()
        return

    q = broadcaster.subscribe(race_id)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=60.0)
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_json({"type": "ping"})
                continue
            await websocket.send_json(msg)
            if msg.get("type") == "finished":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("WebSocket error for race %s", race_id)
    finally:
        broadcaster.unsubscribe(race_id, q)
