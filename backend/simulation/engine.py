"""
Pure simulation engine — no I/O, no side-effects.

Takes a Race snapshot, returns a list of EntryResult objects ranked by position.
All randomness is seeded from the race ID so the result is deterministic per race.
"""
from __future__ import annotations

import hashlib
import math
import random
from typing import Iterator, Optional

from backend.config import (
    SLOT_NAMES,
    TIER_SCORES,
    EVENT_SLOT_WEIGHTS,
    SLOT_WEIGHT_UNITS,
    WEIGHT_LIMIT,
    BASE_WEAR_PCT,
    WEAR_MULTIPLIERS,
    EVENT_STRESSED_SLOTS,
    TILE_FEET,
    TOP_SPEED_FPS,
    CORNER_SPEED_FPS,
    CHICANE_SPEED_FPS,
    ACCEL_FPS2,
    BRAKE_FPS2,
    MPH_TO_FPS,
    RACE_TICK_INTERVAL_MS,
    TRAILING_GRACE_TICKS,
)
from backend.models import CarSlots, EntryResult, Race, RaceEntry, SlotPart, SlotResult, TrackData

# ── Luck narrative tags ────────────────────────────────────────────────────────
_LUCK_TAGS_POSITIVE = [
    "Perfect run through all sectors",
    "Clean air throughout",
    "Flawless pit strategy",
    "Ideal conditions hit at the right moment",
    "Competitor incident cleared the way",
]
_LUCK_TAGS_NEGATIVE = [
    "Mechanical issue on lap 3",
    "Traffic incident cost time",
    "Safety car negated the lead",
    "Unexpected surface grip loss",
    "Debris on track forced evasion",
]
_LUCK_TAG_NEUTRAL = "Uneventful run — luck was a non-factor"


def _seeded_rng(race_id: str, player_id: str) -> random.Random:
    seed = int(hashlib.sha256(f"{race_id}:{player_id}".encode()).hexdigest(), 16) % (2**32)
    return random.Random(seed)


# ── Per-entry computations ────────────────────────────────────────────────────

def _build_quality(car: CarSlots) -> float:
    return sum(TIER_SCORES[car.get_slot(s).tier] for s in SLOT_NAMES) / len(SLOT_NAMES)


def _event_fit(car: CarSlots, event_type: str) -> tuple[float, dict[str, SlotResult]]:
    weights = EVENT_SLOT_WEIGHTS[event_type]
    total_w = sum(weights.values())
    per_slot: dict[str, SlotResult] = {}

    weighted_sum = 0.0
    for s in SLOT_NAMES:
        part = car.get_slot(s)
        ts = TIER_SCORES[part.tier]
        w  = weights[s]
        ws = ts * w
        weighted_sum += ws
        per_slot[s] = SlotResult(
            tier=part.tier,
            readiness=part.readiness,
            tier_score=ts,
            event_weight=w,
            weighted_score=ws / total_w,   # normalised contribution
            readiness_penalty=0.0,
        )

    raw_fit = weighted_sum / total_w  # 0-100

    # Event-specific penalties
    penalty = 0.0
    if event_type == "wet_track" and car.tires.tier == "standard":
        penalty += 15.0
    elif event_type == "night_race" and car.electronics.tier == "standard":
        penalty += 10.0
    elif event_type == "endurance":
        if car.tires.readiness < 50 or car.fuel.readiness < 50:
            penalty += 10.0
    elif event_type == "weight_limit":
        total_weight = sum(SLOT_WEIGHT_UNITS[s][car.get_slot(s).tier] for s in SLOT_NAMES)
        if total_weight > WEIGHT_LIMIT:
            penalty += 20.0  # −10 each for aero and fuel

    return max(0.0, raw_fit - penalty), per_slot


def _readiness_score(car: CarSlots, per_slot: dict[str, SlotResult]) -> float:
    total = 0.0
    for s in SLOT_NAMES:
        r = car.get_slot(s).readiness
        penalty = 0.0
        if r < 50:
            penalty = 50.0 - r  # readiness below 50 → subtract the gap again
            r = max(0.0, r - penalty)
            per_slot[s] = per_slot[s].model_copy(update={"readiness_penalty": penalty})
        total += r
    return total / len(SLOT_NAMES)


def _check_dnf(car: CarSlots, rng: random.Random) -> tuple[bool, Optional[str]]:
    for s in SLOT_NAMES:
        if car.get_slot(s).readiness < 20:
            if rng.random() < 0.10:
                return True, s
    return False, None


def _luck_tag(delta: float) -> str:
    if delta > 5:
        return random.choice(_LUCK_TAGS_POSITIVE)
    if delta < -5:
        return random.choice(_LUCK_TAGS_NEGATIVE)
    return _LUCK_TAG_NEUTRAL


# ── Main entry point ──────────────────────────────────────────────────────────

def simulate_race(race: Race) -> list[EntryResult]:
    """
    Simulate all entries, return EntryResult list sorted by position (1st first).
    Deterministic: seeded from race.id + player_id.
    """
    event_type = race.event_type
    is_time_trial = event_type == "time_trial"
    luck_range = 5.0 if is_time_trial else 15.0
    bq_weight = 0.50 if is_time_trial else 0.40

    raw_results: list[dict] = []

    for entry in race.entries:
        car = entry.locked_car
        if car is None:
            continue  # entry never locked (shouldn't happen)

        rng = _seeded_rng(race.id, entry.player_id)

        dnf, dnf_slot = _check_dnf(car, rng)

        bq = _build_quality(car)
        ef, per_slot = _event_fit(car, event_type)
        rs = _readiness_score(car, per_slot)
        luck = rng.uniform(-luck_range, luck_range)

        if dnf:
            score = 0.0
        else:
            score = (bq * bq_weight) + (ef * 0.35) + (rs * 0.25) + luck
            score = max(0.0, min(100.0, score))

        raw_results.append({
            "player_id": entry.player_id,
            "username": entry.username,
            "score": score,
            "build_quality": bq,
            "event_fit": ef,
            "readiness_score": rs,
            "luck_delta": luck,
            "per_slot": per_slot,
            "dnf": dnf,
            "dnf_slot": dnf_slot,
        })

    # Sort descending by score (DNF = 0 sorts last)
    raw_results.sort(key=lambda r: r["score"], reverse=True)

    # Counterfactual: what position without luck?
    neutral_scores = [
        (r["player_id"],
         (r["build_quality"] * bq_weight) + (r["event_fit"] * 0.35) + (r["readiness_score"] * 0.25))
        for r in raw_results
    ]
    neutral_scores.sort(key=lambda x: x[1], reverse=True)
    cf_rank = {pid: i + 1 for i, (pid, _) in enumerate(neutral_scores)}

    results: list[EntryResult] = []
    for pos, r in enumerate(raw_results, start=1):
        results.append(EntryResult(
            player_id=r["player_id"],
            username=r["username"],
            position=pos,
            result_score=round(r["score"], 2),
            build_quality=round(r["build_quality"], 2),
            event_fit=round(r["event_fit"], 2),
            readiness_score=round(r["readiness_score"], 2),
            luck_delta=round(r["luck_delta"], 2),
            counterfactual_position=cf_rank[r["player_id"]],
            per_slot=r["per_slot"],
            luck_tag=_luck_tag(r["luck_delta"]),
            dnf=r["dnf"],
            dnf_slot=r["dnf_slot"],
        ))

    return results


# ── Speed profile generation ──────────────────────────────────────────────────

def build_speed_profile(track: TrackData) -> list[float]:
    """Build per-tile max safe speed (ft/s) via iterative constraint passes.

    1. Raw target: straight → TOP_SPEED_FPS, curve → CORNER_SPEED_FPS,
       chicane → CHICANE_SPEED_FPS
    2. Backward pass: braking constraint
    3. Forward pass: acceleration constraint
    4. Iterate until stable (cap at 10 passes)
    """
    # Map (x, y) → tile type for O(1) lookup
    tile_type_by_pos: dict[tuple[int, int], str] = {}
    for tile in track.tiles:
        tile_type_by_pos[(tile.x, tile.y)] = tile.type

    n = len(track.path_order)
    speed = [0.0] * n

    # 1. Raw target per tile
    for i, pos in enumerate(track.path_order):
        tt = tile_type_by_pos.get((pos[0], pos[1]), "straight")
        if tt == "chicane":
            speed[i] = CHICANE_SPEED_FPS
        elif tt == "curve":
            speed[i] = CORNER_SPEED_FPS
        else:
            speed[i] = TOP_SPEED_FPS

    # 2-4. Iterative constraint passes (closed loop)
    for _ in range(10):
        changed = False

        # Backward pass: braking constraint
        for i in range(n):
            nxt = (i + 1) % n
            limit = math.sqrt(speed[nxt] ** 2 + 2.0 * BRAKE_FPS2 * TILE_FEET)
            if speed[i] > limit + 0.01:
                speed[i] = limit
                changed = True

        # Forward pass: acceleration constraint
        for i in range(n):
            prev = (i - 1) % n
            limit = math.sqrt(speed[prev] ** 2 + 2.0 * ACCEL_FPS2 * TILE_FEET)
            if speed[i] > limit + 0.01:
                speed[i] = limit
                changed = True

        if not changed:
            break

    return speed


# ── Tick stream generation ─────────────────────────────────────────────────────

def generate_tick_stream(
    results: list[EntryResult],
    lap_count: int = 25,
    track: TrackData | None = None,
) -> Iterator[dict]:
    """Yield tick snapshots with physics-based car movement.

    Each tick: {tick, lap_count, cars: [{car_id, username, progress, speed, incident}]}
    Progress: 0.0 → 1.0 over the full race distance (lap_count × track length).
    Cars accelerate/brake per the speed profile; slower cars have a lower top speed.
    DNF cars stop at a random point (0.3–0.7 progress).
    """
    if not results:
        return

    dt = RACE_TICK_INTERVAL_MS / 1000.0  # seconds per tick

    # Build speed profile from track (or use flat top speed as fallback)
    if track and track.path_order:
        profile = build_speed_profile(track)
        n_tiles = len(track.path_order)
    else:
        profile = [TOP_SPEED_FPS]
        n_tiles = 1

    total_distance = TILE_FEET * n_tiles * lap_count  # total race distance in feet

    max_score = max(r.result_score for r in results) or 1.0

    # Per-car state
    car_pos: dict[str, float] = {}       # feet travelled
    car_vel: dict[str, float] = {}       # ft/s
    car_finished: dict[str, int | None] = {}  # tick when car finished (or None)
    car_factor: dict[str, float] = {}    # speed multiplier (0.3–1.0)
    dnf_stop: dict[str, float] = {}      # progress at which DNF car stops
    dnf_fired: dict[str, bool] = {}      # whether dnf_start incident was emitted

    for r in results:
        pid = r.player_id
        car_pos[pid] = 0.0
        car_vel[pid] = 0.0
        car_finished[pid] = None
        car_factor[pid] = max(0.3, r.result_score / max_score)
        if r.dnf:
            rng = random.Random(hash(pid))
            dnf_stop[pid] = rng.uniform(0.3, 0.7)
            dnf_fired[pid] = False

    leader_finished_tick: int | None = None
    tick_num = 0
    max_ticks = 200_000  # safety cap

    while tick_num < max_ticks:
        tick_num += 1
        cars_data = []
        all_done = True

        for r in results:
            pid = r.player_id

            # Already finished — emit final state
            if car_finished[pid] is not None:
                cars_data.append({
                    "car_id": pid,
                    "username": r.username,
                    "progress": round(min(1.0, car_pos[pid] / total_distance), 4),
                    "speed": round(car_vel[pid] / MPH_TO_FPS, 0),
                    "incident": "dnf" if r.dnf else None,
                })
                continue

            # DNF: check if at stop point
            if r.dnf and pid in dnf_stop:
                stop_dist = dnf_stop[pid] * total_distance
                if car_pos[pid] >= stop_dist:
                    car_vel[pid] = 0.0
                    car_finished[pid] = tick_num
                    incident = "dnf_start" if not dnf_fired[pid] else "dnf"
                    dnf_fired[pid] = True
                    cars_data.append({
                        "car_id": pid,
                        "username": r.username,
                        "progress": round(car_pos[pid] / total_distance, 4),
                        "speed": 0.0,
                        "incident": incident,
                    })
                    continue

            all_done = False

            # Physics step: look up speed profile at current tile
            lap_distance = TILE_FEET * n_tiles
            feet_into_lap = car_pos[pid] % lap_distance
            tile_idx = int(feet_into_lap / TILE_FEET) % n_tiles
            target = profile[tile_idx] * car_factor[pid]

            vel = car_vel[pid]
            if vel < target:
                vel = min(target, vel + ACCEL_FPS2 * dt)
            elif vel > target:
                vel = max(target, vel - BRAKE_FPS2 * dt)
            car_vel[pid] = vel
            car_pos[pid] += vel * dt

            progress = car_pos[pid] / total_distance

            # Check if this car just finished
            if progress >= 1.0:
                car_pos[pid] = total_distance
                car_finished[pid] = tick_num
                if leader_finished_tick is None:
                    leader_finished_tick = tick_num

            incident = None
            cars_data.append({
                "car_id": pid,
                "username": r.username,
                "progress": round(min(1.0, car_pos[pid] / total_distance), 4),
                "speed": round(car_vel[pid] / MPH_TO_FPS, 0),
                "incident": incident,
            })

        yield {
            "tick": tick_num,
            "lap_count": lap_count,
            "cars": cars_data,
        }

        # End conditions
        if all_done:
            break
        if leader_finished_tick is not None:
            if tick_num - leader_finished_tick >= TRAILING_GRACE_TICKS:
                break


def apply_wear(car: CarSlots, event_type: str) -> CarSlots:
    """Return a new CarSlots with readiness reduced per event wear rules."""
    multiplier = WEAR_MULTIPLIERS.get(event_type, 1.0)
    stressed = EVENT_STRESSED_SLOTS.get(event_type, [])
    updated: dict = {}
    for s in SLOT_NAMES:
        part = car.get_slot(s)
        wear = BASE_WEAR_PCT * multiplier
        if s in stressed:
            wear *= 1.5
        new_r = max(0.0, part.readiness - wear)
        updated[s] = SlotPart(tier=part.tier, readiness=round(new_r, 1))
    return CarSlots(**updated)
