# Game Systems

This document covers the persistent systems players interact with between races: the car, progression, and resource economy.

---

## The Car System

A car is not a single "thing" — it's a **bundle of priorities** expressed through choices.

### Car state is defined by:
- **Configuration** — which parts are installed
- **Readiness** — maintenance level, wear, damage
- **Specialization profile** — what the current build is optimized for (generalist vs specialist)

### Design rules:
- No part should be strictly better than another — each has tradeoffs
- Readiness should be a meaningful strategic lever, not just a tax
- The car should visibly reflect the player's decisions, not be an opaque stat block
- Car state is persisted as part of the player's JSON file (`data/players/{player_id}.json`) — no separate car records

---

## Part Slots

There are **6 part slots**. Each slot accepts exactly one part at a time. Swapping a part costs prep time and credits.

### Slot definitions

| Slot | What it affects | Swap cost (time / credits) | Materials to swap |
|------|-----------------|---------------------------|-------------------|
| **Engine** | Top speed, acceleration, wear rate | 4 h / 800 cr | 2 |
| **Tires** | Wet/surface grip, degradation | 2 h / 300 cr | 1 |
| **Suspension** | Altitude & surface handling | 2 h / 400 cr | 1 |
| **Aero** | High-speed stability, fuel efficiency | 3 h / 600 cr | 2 |
| **Fuel** | Race distance capacity, consumption rate | 1 h / 150 cr | 0 |
| **Electronics** | Spec_class compliance, data readout quality | 3 h / 500 cr | 2 |

### Part tiers

Each slot has three tier levels with the following stat deltas applied to that slot's contribution score (0–100 scale):

| Tier | Base contribution score | Unlock condition |
|------|------------------------|------------------|
| **Standard** | 40 | Available from start |
| **Upgraded** | 70 | 10 races entered |
| **Performance** | 100 | 30 races entered |

Tier is per-slot — a player can have Performance Engine but Standard Tires. Each tier is purchased separately; upgrading does not carry over cost from the previous tier.

### Synergy / anti-synergy (prototype scope)
- No synergy bonuses in prototype — each slot contributes independently
- Anti-synergy flag reserved for post-alpha (e.g., Performance Engine + Standard Fuel may conflict)

---

## Track Generation

Each race gets a **randomly generated track** built from a set of square image tiles.

### Tile types:
| Tile | Variants |
|------|----------|
| Straight | Horizontal, Vertical |
| Curve | 4 orientations (NW, NE, SE, SW corner) |
| Chicane | Horizontal, Vertical |

### Generation algorithm

1. Start with an **N×N grid** where N comes from the slot's `grid_size` field in `data/schedule.json` (range: **12–60**, i.e. 2–10× a base of 6).
2. Place tiles via a **random walk** beginning at a fixed start cell:
   - At each step, choose a valid adjacent cell (not yet visited)
   - Assign the tile type required to connect the entry and exit directions
3. Walk terminates when it returns to the start cell and the loop is closed
4. Walk bounds scale with grid area:
   - **Max steps:** `N²` — prevents infinite loops on large grids
   - **Min steps before closing:** `max(24, N×2)` — ensures tracks have enough length to be interesting
5. If the walk fails to close, retry (up to **10 retries**)
6. If all retries fail, fall back to a **dynamic rectangular oval** — four straight edges with one-cell border inset; works for any N ≥ 4

### Grid size by event type

| Event type | `grid_size` range | Notes |
|------------|-------------------|-------|
| `time_trial` | 12 – 18 | Small, precision-focused |
| `sprint` | 12 – 24 | Compact and fast |
| `wet_track`, `night_race`, `spec_class` | 18 – 36 | Medium, varied layouts |
| `weight_limit`, `altitude` | 24 – 48 | Larger, more complex |
| `endurance` | 36 – 60 | Longest tracks, most path cells |

### Adjacency constraints:
- Every tile must have a valid connection to each of its path-neighbors (no dead ends, no direction mismatches)
- Chicane tiles may only be placed if the preceding and following tiles can accommodate the direction change

### Track data format (in race JSON):
```json
{
  "track": {
    "grid_width": 24,
    "grid_height": 24,
    "tiles": [
      { "x": 0, "y": 3, "type": "straight", "orientation": "horizontal" },
      { "x": 1, "y": 3, "type": "curve",    "orientation": "SE" }
    ],
    "path_order": [[0,3], [1,3], "..."]
  }
}
```
- `tiles` is the full grid for rendering
- `path_order` is the ordered sequence of tile coordinates the car traverses — used to derive the `CatmullRomCurve3` on the frontend

### Design intent:
- Random tracks mean no race is identical; players cannot memorise a fixed layout
- Track shape is not strategically meaningful to players (they never know it in advance), so it only affects the visual, not the prep decision

---

## Progression System

Progression expands the player's **option space**, not just their numbers.

### Prototype scope
- All 6 slot types are available from race 1 at **Standard tier**
- **Upgraded tier** unlocks after **10 races entered** (cumulative, any event type)
- **Performance tier** unlocks after **30 races entered**
- No other gates in prototype — further complexity expands in post-alpha

### Players gain access to:
- More ways to specialize (wider variety of parts and build archetypes via tier upgrades)
- More event types and race constraints to plan around
- More investment options: crafting, long-term upgrades, repair paths (post-alpha)

### Progression must not:
- Simply inflate base stats — bigger numbers aren't more interesting
- Remove older options — earlier builds should remain viable at appropriate tiers
- Gate tradeoffs behind progression — tradeoffs should exist at all levels

---

## Resource Economy

Resources exist to **force choices**. The economy is a constraint system, not a reward shower.

### Starting values
- **Starting credits:** 5,000 cr
- **Starting materials:** 10

### Race entry fees (by event tier)
| Event tier | Entry fee |
|------------|-----------|
| Standard | 100 cr |
| Mid-tier | 300 cr |
| Premium | 500 cr |

*(Prototype: all events use 100 cr entry fee until event tiers are defined)*

### Finishing rewards
| Position | Reward |
|----------|--------|
| 1st | 800 cr |
| 2nd | 500 cr |
| 3rd | 300 cr |
| 4th – last | 100 cr |

### Materials
- **1 material** per repair action (restoring readiness without swapping parts)
- **0–3 materials** per slot swap (see slot table above)
- Materials are not earned from race rewards in prototype; sources to be defined in post-alpha

### Prep window
- Each real-world 10-minute gap between races is one **prep window**
- Each slot action (swap or repair) costs **5–20 minutes** of prep time:

| Action | Prep time cost |
|--------|---------------|
| Fuel slot swap | 5 min |
| Tires slot swap | 10 min |
| Suspension slot swap | 10 min |
| Aero slot swap | 15 min |
| Electronics slot swap | 15 min |
| Engine slot swap | 20 min |
| Any slot repair (restore readiness) | 5 min |

### Core constraints:
- You cannot maximize everything at once
- Improving one area means delaying another
- Entering a race has a cost (explicit fee, wear, time) — you pick your battles
- Players should never be stuck with zero agency — always a valid if suboptimal path
- Windfalls (big race rewards) should create interesting decisions, not just inflate everything

---

## Wear & Damage

### Readiness degradation per race

Each race reduces the readiness of installed parts based on event type:

| Event type | Wear multiplier | Base wear (Standard tier) |
|------------|-----------------|--------------------------|
| sprint | 1.0× | 15% readiness lost |
| time_trial | 0.8× | 12% readiness lost |
| night_race | 1.0× | 15% readiness lost |
| spec_class | 1.0× | 15% readiness lost |
| weight_limit | 1.0× | 15% readiness lost |
| wet_track | 1.2× | 18% readiness lost |
| altitude | 1.1× | 17% readiness lost |
| endurance | 1.8× | 27% readiness lost |

*Wear is applied to all slots equally unless a slot is the "best slot" for that event type, in which case it takes 1.5× the base wear (working harder).*

### Readiness thresholds

| Readiness | Effect |
|-----------|--------|
| 100% – 50% | No penalty; full contribution to `result_score` |
| 49% – 20% | Penalty applied: slot contribution reduced by `(50 - readiness) × 1.0` points |
| Below 20% | **DNF risk**: 10% chance per race of a Did Not Finish incident (result_score = 0) |

### Repair
- **Full repair** restores any slot to 100% readiness
- Repair cost: 5 minutes prep time + 1 material (any slot)
- Credits cost: no credit cost for repair — only time and materials

### Design rule:
- Readiness is a strategic lever, not just a tax. A player who skips repair to enter more races is making a valid (if risky) tradeoff.
