"""Bot entry generation — fills race grids with AI competitors."""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone

from backend.config import BOT_GRID_TARGET, BOT_PLAYER_ID_PREFIX, SLOT_NAMES
from backend.models import CarSlots, RaceEntry, SlotPart

BOT_NAMES = [
    "Bot Alpha", "Bot Bravo", "Bot Charlie", "Bot Delta", "Bot Echo",
    "Bot Foxtrot", "Bot Golf", "Bot Hotel", "Bot India", "Bot Juliet",
    "Bot Kilo", "Bot Lima", "Bot Mike", "Bot November", "Bot Oscar",
    "Bot Papa", "Bot Quebec", "Bot Romeo", "Bot Sierra", "Bot Tango",
    "Bot Uniform", "Bot Victor", "Bot Whiskey", "Bot X-ray", "Bot Yankee",
    "Bot Zulu",
]

# Skill brackets: (tier_weights, readiness_range)
# tier_weights = probability weights for [standard, upgraded, performance]
BRACKETS = {
    "weak":   {"tier_weights": [0.70, 0.25, 0.05], "readiness": (50, 85)},
    "mid":    {"tier_weights": [0.30, 0.50, 0.20], "readiness": (60, 95)},
    "strong": {"tier_weights": [0.05, 0.45, 0.50], "readiness": (75, 100)},
}
BRACKET_ORDER = ["weak", "mid", "strong"]
TIERS = ["standard", "upgraded", "performance"]


def _bot_rng(race_id: str, bot_index: int) -> random.Random:
    """Deterministic RNG seeded from race_id + bot index."""
    seed = hashlib.sha256(f"{race_id}:bot:{bot_index}".encode()).hexdigest()
    return random.Random(seed)


def _generate_bot_car(rng: random.Random, bracket: dict) -> CarSlots:
    """Build a CarSlots with random tiers/readiness for the given bracket."""
    weights = bracket["tier_weights"]
    lo, hi = bracket["readiness"]
    slots = {}
    for name in SLOT_NAMES:
        tier = rng.choices(TIERS, weights=weights, k=1)[0]
        readiness = round(rng.uniform(lo, hi), 1)
        slots[name] = SlotPart(tier=tier, readiness=readiness)
    return CarSlots(**slots)


def generate_bot_entries(race_id: str, current_entry_count: int) -> list[RaceEntry]:
    """Create bot RaceEntry objects to fill the grid up to BOT_GRID_TARGET."""
    bots_needed = max(0, BOT_GRID_TARGET - current_entry_count)
    if bots_needed == 0:
        return []

    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    entries = []

    for i in range(bots_needed):
        rng = _bot_rng(race_id, i)
        bracket_name = BRACKET_ORDER[i % len(BRACKET_ORDER)]
        bracket = BRACKETS[bracket_name]
        car = _generate_bot_car(rng, bracket)
        name = BOT_NAMES[i % len(BOT_NAMES)]

        entries.append(RaceEntry(
            player_id=f"{BOT_PLAYER_ID_PREFIX}{i}",
            username=name,
            locked_car=car,
            entered_at=now,
        ))

    return entries
