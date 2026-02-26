"""
Race lifecycle jobs — the single write authority for race results.

Flow per race:
  T-10 min  → lock_race_entries()   — freeze builds, no more entry/withdrawal
  T+0 min   → run_race_job()        — simulate, broadcast ticks, save results, apply wear
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.config import (
    FINISH_REWARDS, DEFAULT_REWARD, ENTRY_FEE,
    RACE_TICK_INTERVAL_MS, SCHEDULE_FILE,
    RACE_LAP_COUNT_DEFAULT, TRACK_GRID_SIZE,
)
from backend.models import Race, RaceEntry
from backend.storage import load_race, save_race, load_player, save_player
from backend.simulation.engine import simulate_race, generate_tick_stream, apply_wear
from backend.broadcast.race_broadcaster import broadcaster
from backend.track_gen import generate_track

log = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _race_id(date: str, slot_time: str) -> str:
    return f"{date}_{slot_time}"


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


async def ensure_race_exists(
    race_id: str,
    scheduled_dt: datetime,
    event_type: str,
    lap_count: int = RACE_LAP_COUNT_DEFAULT,
    grid_size: int = TRACK_GRID_SIZE,
) -> None:
    """Create the race JSON file if it doesn't already exist."""
    from backend.storage import race_path
    if race_path(race_id).exists():
        return
    track = generate_track(n=grid_size)
    race = Race(
        id=race_id,
        scheduled_time=_iso(scheduled_dt),
        event_type=event_type,
        status="open",
        entry_fee=ENTRY_FEE,
        lap_count=lap_count,
        grid_size=grid_size,
        track=track,
    )
    await save_race(race)
    log.info("Created race %s (%s, %d laps, %dx%d grid)", race_id, event_type, lap_count, grid_size, grid_size)


async def lock_race_entries(race_id: str) -> None:
    """Lock all entries: snapshot the current car state as locked_car."""
    race = await load_race(race_id)
    if not race or race.status != "open":
        return

    locked_entries = []
    for entry in race.entries:
        player = await load_player(entry.player_id)
        if player:
            locked_entries.append(
                entry.model_copy(update={"locked_car": player.car})
            )
        else:
            locked_entries.append(entry)

    race = race.model_copy(update={"status": "locked", "entries": locked_entries})
    await save_race(race)
    log.info("Locked entries for race %s (%d entrants)", race_id, len(locked_entries))


async def run_race_job(race_id: str) -> None:
    """Simulate race, broadcast ticks, save results, apply wear and rewards."""
    race = await load_race(race_id)
    if not race:
        log.warning("run_race_job: race %s not found", race_id)
        return
    if race.status not in ("open", "locked"):
        return  # already ran or cancelled

    # Lock any remaining open entries (in case lock job didn't fire)
    if race.status == "open":
        await lock_race_entries(race_id)
        race = await load_race(race_id)

    # Fill grid with bot entries
    from backend.bots import generate_bot_entries
    bot_entries = generate_bot_entries(race_id, len(race.entries))
    if bot_entries:
        race = race.model_copy(update={"entries": race.entries + bot_entries})
        await save_race(race)

    race = race.model_copy(update={"status": "running"})
    await save_race(race)
    await broadcaster.broadcast(race_id, {"type": "status", "status": "running"})

    # Simulate
    results = simulate_race(race)
    tick_stream = generate_tick_stream(results, lap_count=race.lap_count, track=race.track)

    # Broadcast ticks (generator — streamed directly, constant memory)
    interval = RACE_TICK_INTERVAL_MS / 1000.0
    for tick_msg in tick_stream:
        await broadcaster.broadcast(race_id, {"type": "tick", **tick_msg})
        await asyncio.sleep(interval)

    # Broadcast final results
    results_payload = [r.model_dump() for r in results]
    await broadcaster.broadcast(race_id, {"type": "finished", "results": results_payload})

    # Save finished race
    race = race.model_copy(update={"status": "finished", "results": results})
    await save_race(race)

    # Apply rewards + wear to each entrant
    for result in results:
        player = await load_player(result.player_id)
        if not player:
            continue
        reward = FINISH_REWARDS.get(result.position, DEFAULT_REWARD)
        new_car = apply_wear(player.car, race.event_type)
        player = player.model_copy(update={
            "credits": player.credits + reward,
            "races_entered": player.races_entered + 1,
            "car": new_car,
        })
        await save_player(player)

    log.info("Race %s finished — %d results saved", race_id, len(results))

    # Top-up the rolling window so there are always ~RACE_WINDOW upcoming races
    if _scheduler is not None:
        await register_next_n_races(_scheduler, RACE_WINDOW)


# ── Rolling window scheduler ─────────────────────────────────────────────────

RACE_WINDOW = 30  # keep this many upcoming races registered at all times

_scheduler: AsyncIOScheduler | None = None


def _parse_slot_time(slot_time: str, base_date: datetime) -> datetime:
    """Parse HH:MM relative to base_date (UTC)."""
    h, m = map(int, slot_time.split(":"))
    return base_date.replace(hour=h, minute=m, second=0, microsecond=0, tzinfo=timezone.utc)


async def register_next_n_races(scheduler: AsyncIOScheduler, n: int = RACE_WINDOW) -> int:
    """Ensure the next `n` future races exist and have APScheduler jobs.

    Walks forward from the current UTC time through the repeating 144-slot
    daily schedule, crossing day boundaries as needed.  Idempotent — safe to
    call after every race or on startup.

    Returns the number of *new* races created.
    """
    from backend.storage import race_path

    schedule = json.loads(SCHEDULE_FILE.read_text())
    slots = schedule["slots"]
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)

    # Find the first slot index whose time is still in the future today
    start_idx = 0
    base_date = today
    for i, slot in enumerate(slots):
        slot_dt = _parse_slot_time(slot["time"], base_date)
        if slot_dt > now:
            start_idx = i
            break
    else:
        # All of today's slots are in the past → start from slot 0 tomorrow
        start_idx = 0
        base_date = today + timedelta(days=1)

    created = 0
    counted = 0  # total future races accounted for (existing + new)
    idx = start_idx
    current_date = base_date

    while counted < n:
        if idx >= len(slots):
            idx = 0
            current_date += timedelta(days=1)

        slot = slots[idx]
        slot_dt = _parse_slot_time(slot["time"], current_date)
        date_str = current_date.strftime("%Y-%m-%d")
        race_id = _race_id(date_str, slot["time"])
        event_type = slot["event_type"]
        lap_count = slot.get("lap_count", RACE_LAP_COUNT_DEFAULT)
        grid_size = slot.get("grid_size", TRACK_GRID_SIZE)

        is_new = not race_path(race_id).exists()
        await ensure_race_exists(race_id, slot_dt, event_type, lap_count=lap_count, grid_size=grid_size)
        if is_new:
            created += 1

        # Schedule APScheduler jobs (idempotent via replace_existing)
        lock_dt = slot_dt - timedelta(minutes=10)
        if lock_dt > now:
            scheduler.add_job(
                lock_race_entries,
                "date",
                run_date=lock_dt,
                args=[race_id],
                id=f"lock_{race_id}",
                replace_existing=True,
            )
        if slot_dt > now:
            scheduler.add_job(
                run_race_job,
                "date",
                run_date=slot_dt,
                args=[race_id],
                id=f"run_{race_id}",
                replace_existing=True,
            )

        counted += 1
        idx += 1

    log.info("register_next_n_races: %d counted, %d newly created", counted, created)
    return created


async def reset_schedule(scheduler: AsyncIOScheduler) -> int:
    """Admin action: wipe all races and create a fresh batch of RACE_WINDOW races."""
    from backend.storage import delete_all_races

    # Remove all APScheduler race jobs
    for job in scheduler.get_jobs():
        if job.id.startswith("lock_") or job.id.startswith("run_"):
            job.remove()

    deleted = await delete_all_races()
    log.info("reset_schedule: deleted %d race files", deleted)

    created = await register_next_n_races(scheduler, RACE_WINDOW)
    log.info("reset_schedule: created %d fresh races", created)
    return created


async def setup_scheduler() -> AsyncIOScheduler:
    """Initialise and start the scheduler; register the next RACE_WINDOW races."""
    global _scheduler
    scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler = scheduler

    await register_next_n_races(scheduler, RACE_WINDOW)

    scheduler.start()
    return scheduler
