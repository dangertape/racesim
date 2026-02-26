"""JSON file I/O with per-file async locking to prevent concurrent writes."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import TypeVar, Type

from pydantic import BaseModel

from backend.config import PLAYERS_DIR, RACES_DIR

T = TypeVar("T", bound=BaseModel)

# One asyncio.Lock per file path — created on first access
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(path: Path) -> asyncio.Lock:
    key = str(path)
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


def ensure_dirs() -> None:
    PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
    RACES_DIR.mkdir(parents=True, exist_ok=True)


# ── Generic helpers ───────────────────────────────────────────────────────────

async def load_json(path: Path, model: Type[T]) -> T | None:
    if not path.exists():
        return None
    async with _lock_for(path):
        text = path.read_text(encoding="utf-8")
    return model.model_validate_json(text)


async def save_json(path: Path, obj: BaseModel) -> None:
    async with _lock_for(path):
        path.write_text(obj.model_dump_json(indent=2), encoding="utf-8")


# ── Players ───────────────────────────────────────────────────────────────────

def player_path(player_id: str) -> Path:
    return PLAYERS_DIR / f"{player_id}.json"


async def load_player(player_id: str):
    from backend.models import Player
    return await load_json(player_path(player_id), Player)


async def save_player(player) -> None:
    await save_json(player_path(player.id), player)


async def find_player_by_username(username: str):
    """Linear scan — fine for prototype scale."""
    from backend.models import Player
    for f in PLAYERS_DIR.glob("*.json"):
        p = await load_json(f, Player)
        if p and p.username == username:
            return p
    return None


# ── Races ─────────────────────────────────────────────────────────────────────

def race_path(race_id: str) -> Path:
    return RACES_DIR / f"{race_id}.json"


async def load_race(race_id: str):
    from backend.models import Race
    return await load_json(race_path(race_id), Race)


async def save_race(race) -> None:
    await save_json(race_path(race.id), race)


async def delete_all_races() -> int:
    """Delete all race JSON files. Returns the number of files deleted."""
    count = 0
    for f in RACES_DIR.glob("*.json"):
        f.unlink()
        # Remove any lock we were holding for this path
        key = str(f)
        _locks.pop(key, None)
        count += 1
    return count


async def list_races() -> list:
    """Return all Race objects sorted by scheduled_time."""
    from backend.models import Race
    races = []
    for f in sorted(RACES_DIR.glob("*.json")):
        r = await load_json(f, Race)
        if r:
            races.append(r)
    races.sort(key=lambda r: r.scheduled_time)
    return races
