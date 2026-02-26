"""Pydantic models for all persistent game entities."""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from pydantic import BaseModel, Field

from backend.config import SLOT_NAMES, STARTING_CREDITS, STARTING_MATERIALS

Tier = Literal["standard", "upgraded", "performance"]
RaceStatus = Literal["upcoming", "open", "locked", "running", "finished"]


# ── Car ───────────────────────────────────────────────────────────────────────

class SlotPart(BaseModel):
    tier: Tier = "standard"
    readiness: float = Field(100.0, ge=0.0, le=100.0)


class CarSlots(BaseModel):
    engine:      SlotPart = Field(default_factory=SlotPart)
    tires:       SlotPart = Field(default_factory=SlotPart)
    suspension:  SlotPart = Field(default_factory=SlotPart)
    aero:        SlotPart = Field(default_factory=SlotPart)
    fuel:        SlotPart = Field(default_factory=SlotPart)
    electronics: SlotPart = Field(default_factory=SlotPart)

    def get_slot(self, name: str) -> SlotPart:
        return getattr(self, name)

    def set_slot(self, name: str, part: SlotPart) -> None:
        setattr(self, name, part)

    def all_slots(self) -> list[tuple[str, SlotPart]]:
        return [(s, getattr(self, s)) for s in SLOT_NAMES]


# ── Player ────────────────────────────────────────────────────────────────────

class Player(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    hashed_password: str
    credits: int = STARTING_CREDITS
    materials: int = STARTING_MATERIALS
    races_entered: int = 0
    car: CarSlots = Field(default_factory=CarSlots)


# ── Race ──────────────────────────────────────────────────────────────────────

class TileData(BaseModel):
    x: int
    y: int
    type: Literal["straight", "curve", "chicane"]
    orientation: str  # "horizontal" | "vertical" | "NE" | "NW" | "SE" | "SW"


class TrackData(BaseModel):
    grid_width: int
    grid_height: int
    tiles: list[TileData]
    path_order: list[list[int]]  # [[x,y], ...]


class RaceEntry(BaseModel):
    player_id: str
    username: str
    locked_car: Optional[CarSlots] = None  # set when entry locks (T-10 min)
    entered_at: str  # ISO-8601


class SlotResult(BaseModel):
    tier: str
    readiness: float
    tier_score: int
    event_weight: float
    weighted_score: float
    readiness_penalty: float = 0.0


class EntryResult(BaseModel):
    player_id: str
    username: str
    position: int
    result_score: float
    build_quality: float
    event_fit: float
    readiness_score: float
    luck_delta: float
    counterfactual_position: int
    per_slot: dict[str, SlotResult]
    luck_tag: str
    dnf: bool = False
    dnf_slot: Optional[str] = None


class Race(BaseModel):
    id: str                               # "YYYY-MM-DD_HH:MM"
    scheduled_time: str                   # ISO-8601 UTC
    event_type: str
    status: RaceStatus = "upcoming"
    entry_fee: int = 100
    lap_count: int = 25                   # set from schedule.json slot (25–250)
    grid_size: int = 12                   # track grid n×n (12–60); set at race creation
    track: Optional[TrackData] = None
    entries: list[RaceEntry] = Field(default_factory=list)
    results: list[EntryResult] = Field(default_factory=list)
