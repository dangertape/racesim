"""Central configuration — paths, game constants, event tables."""
from pathlib import Path
import os

# ── Filesystem paths ──────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PLAYERS_DIR = DATA_DIR / "players"
RACES_DIR = DATA_DIR / "races"
SCHEDULE_FILE = DATA_DIR / "schedule.json"
STATIC_DIR = ROOT / "PNG"
CAR_GLB = ROOT / "car.glb"

# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

# ── Economy ───────────────────────────────────────────────────────────────────
STARTING_CREDITS = 5_000
STARTING_MATERIALS = 10
ENTRY_FEE = 100  # flat for prototype
FINISH_REWARDS = {1: 800, 2: 500, 3: 300}  # anything else → 100
DEFAULT_REWARD = 100

# ── Car / parts ───────────────────────────────────────────────────────────────
SLOT_NAMES = ["engine", "tires", "suspension", "aero", "fuel", "electronics"]

TIER_SCORES: dict[str, int] = {
    "standard": 40,
    "upgraded": 70,
    "performance": 100,
}

TIER_UNLOCK_RACES = {
    "standard": 0,
    "upgraded": 10,
    "performance": 30,
}

# Swap costs: time (minutes of prep window), credits, materials
SLOT_SWAP_COSTS: dict[str, dict] = {
    "engine":      {"time_min": 20, "credits": 800, "materials": 2},
    "tires":       {"time_min": 10, "credits": 300, "materials": 1},
    "suspension":  {"time_min": 10, "credits": 400, "materials": 1},
    "aero":        {"time_min": 15, "credits": 600, "materials": 2},
    "fuel":        {"time_min":  5, "credits": 150, "materials": 0},
    "electronics": {"time_min": 15, "credits": 500, "materials": 2},
}

# Weight units for weight_limit events (tier → units)
SLOT_WEIGHT_UNITS: dict[str, dict[str, int]] = {
    "engine":      {"standard": 10, "upgraded": 14, "performance": 18},
    "tires":       {"standard":  8, "upgraded": 10, "performance": 13},
    "suspension":  {"standard":  6, "upgraded":  8, "performance": 11},
    "aero":        {"standard":  5, "upgraded":  7, "performance": 10},
    "fuel":        {"standard":  9, "upgraded": 11, "performance": 15},
    "electronics": {"standard":  4, "upgraded":  6, "performance":  9},
}
WEIGHT_LIMIT = 70

# ── Wear ──────────────────────────────────────────────────────────────────────
BASE_WEAR_PCT = 15.0   # percent readiness lost per race at 1.0× multiplier

WEAR_MULTIPLIERS: dict[str, float] = {
    "sprint":       1.0,
    "endurance":    1.8,
    "time_trial":   0.8,
    "wet_track":    1.2,
    "night_race":   1.0,
    "altitude":     1.1,
    "spec_class":   1.0,
    "weight_limit": 1.0,
}

# Slots that work extra hard in each event (take 1.5× base wear)
EVENT_STRESSED_SLOTS: dict[str, list[str]] = {
    "sprint":       ["engine"],
    "endurance":    ["fuel", "tires"],
    "time_trial":   [],
    "wet_track":    ["tires", "suspension"],
    "night_race":   ["electronics"],
    "altitude":     ["suspension", "aero"],
    "spec_class":   ["electronics"],
    "weight_limit": ["aero", "fuel"],
}

# ── Simulation weights (event_fit) ────────────────────────────────────────────
EVENT_SLOT_WEIGHTS: dict[str, dict[str, float]] = {
    "sprint":       {"engine": 1.5, "tires": 1.0, "suspension": 1.0, "aero": 1.0, "fuel": 1.0, "electronics": 1.0},
    "endurance":    {"engine": 1.0, "tires": 1.4, "suspension": 1.0, "aero": 1.0, "fuel": 1.4, "electronics": 1.0},
    "time_trial":   {"engine": 1.0, "tires": 1.0, "suspension": 1.0, "aero": 1.0, "fuel": 1.0, "electronics": 1.0},
    "wet_track":    {"engine": 1.0, "tires": 1.5, "suspension": 1.3, "aero": 1.0, "fuel": 1.0, "electronics": 1.0},
    "night_race":   {"engine": 1.0, "tires": 1.0, "suspension": 1.0, "aero": 1.0, "fuel": 1.0, "electronics": 1.5},
    "altitude":     {"engine": 0.8, "tires": 1.0, "suspension": 1.4, "aero": 1.3, "fuel": 1.0, "electronics": 1.0},
    "spec_class":   {"engine": 1.0, "tires": 1.0, "suspension": 1.0, "aero": 1.0, "fuel": 1.0, "electronics": 1.4},
    "weight_limit": {"engine": 1.0, "tires": 1.0, "suspension": 1.0, "aero": 1.0, "fuel": 1.0, "electronics": 1.0},
}

# ── Track generation ──────────────────────────────────────────────────────────
# TRACK_GRID_SIZE is used only as a fallback default.
# Per-race grid size is stored in schedule.json (range: 12–60, i.e. 2–10× base-6).
TRACK_GRID_SIZE   = 12    # default grid size (fallback)
TRACK_MIN_STEPS   = 24    # minimum path length before loop closes; scaled up with n
TRACK_MAX_RETRIES = 10

# ── Race broadcast ────────────────────────────────────────────────────────────
# RACE_LAP_COUNT is now per-race (stored in schedule.json and Race.lap_count).
# Default used only when a Race is created outside the normal scheduler flow.
RACE_LAP_COUNT_DEFAULT = 25
RACE_TICK_INTERVAL_MS  = 62    # milliseconds between ticks (~16 ticks/sec)

# ── Physics simulation ───────────────────────────────────────────────────────
TILE_FEET              = 30.0
TOP_SPEED_MPH          = 120.0
CORNER_SPEED_MPH       = 60.0
CHICANE_SPEED_MPH      = 45.0
ACCEL_G                = 0.5           # 0.5g acceleration
BRAKE_G                = 1.0           # 1.0g braking
FT_PER_SEC_PER_G       = 32.174
MPH_TO_FPS             = 5280.0 / 3600.0  # 1.4667

# Derived (computed at import time)
TOP_SPEED_FPS          = TOP_SPEED_MPH * MPH_TO_FPS      # ~176 ft/s
CORNER_SPEED_FPS       = CORNER_SPEED_MPH * MPH_TO_FPS   # ~88 ft/s
CHICANE_SPEED_FPS      = CHICANE_SPEED_MPH * MPH_TO_FPS  # ~66 ft/s
ACCEL_FPS2             = ACCEL_G * FT_PER_SEC_PER_G      # ~16.1 ft/s²
BRAKE_FPS2             = BRAKE_G * FT_PER_SEC_PER_G      # ~32.2 ft/s²

TRAILING_GRACE_TICKS   = 160  # ~10s after leader finishes for trailing cars

# ── Bots ─────────────────────────────────────────────────────────────────────
BOT_GRID_TARGET = 6           # total cars per race (players + bots fill to this)
BOT_PLAYER_ID_PREFIX = "bot_" # prefix distinguishes bots from real player UUIDs
