# Event Types

This document defines the mechanical meaning of each event type listed in `data/schedule.json`. Every event type must be legible enough that a player can read it and reason about which build to bring.

---

## Overview

| Event type | Format | Key modifier | Best slot(s) | Wear multiplier |
|------------|--------|--------------|--------------|-----------------|
| `sprint` | Short, single lap | High acceleration weight | Engine | 1.0× |
| `endurance` | Multi-lap | Fuel & degradation matter | Fuel, Tires | 1.8× |
| `time_trial` | Solo runs, no opponents | Pure build quality; luck ±5 | All (even weight) | 0.8× |
| `wet_track` | Normal format | Tires grip ×1.5 weight | Tires, Suspension | 1.2× |
| `night_race` | Normal format | Electronics bonus | Electronics | 1.0× |
| `altitude` | Normal format | Suspension & Aero matter | Suspension, Aero | 1.1× |
| `spec_class` | Weight/spec limits enforced | Electronics compliance check | Electronics | 1.0× |
| `weight_limit` | Max build weight enforced | Aero & Fuel penalized if over | Aero, Fuel | 1.0× |

---

## Detailed Definitions

### `sprint`
**Format:** Single short lap against all entrants simultaneously.

**Mechanics:**
- `event_fit` calculation weights **Engine** contribution at **×1.5** (acceleration matters most)
- High acceleration advantage translates directly to position early in the race; less room to recover
- Wear multiplier: **1.0×** (short race, normal wear)
- No special rule constraints

**Build advice visible to players:** "Acceleration-focused builds perform best. Engine tier is the primary lever."

---

### `endurance`
**Format:** Multi-lap race; **5 laps** for prototype (configurable per event instance in post-alpha).

**Mechanics:**
- `event_fit` calculation weights **Fuel** and **Tires** at **×1.4** each
- **Degradation check:** If Tires or Fuel readiness falls below 50% *entering* the race, an additional −10 penalty is applied to `event_fit` (not `readiness`) to represent mid-race fuel/grip failures
- Wear multiplier: **1.8×** (longest races cause the most wear)
- No special rule constraints

**Build advice visible to players:** "High Fuel and Tires readiness is critical. Entering with worn tires carries significant risk."

---

### `time_trial`
**Format:** Each entrant runs solo; no wheel-to-wheel racing. Positions assigned by comparing all solo scores.

**Mechanics:**
- `event_fit` weights are **equal across all 6 slots** (×1.0 each) — no single slot is advantaged
- **Luck range compressed to ±5** (instead of ±15) — controlled environment, fewer incidents
- `build_quality` weight increases to **×0.5** in the formula (replacing the reduced luck variance): `result_score = (build_quality × 0.5) + (event_fit × 0.35) + (readiness × 0.25) + luck_delta` where `luck_delta` ∈ [−5, +5]
- Wear multiplier: **0.8×** (solo runs, less aggressive racing)
- No opponents, so no positional jostling incidents

**Build advice visible to players:** "Pure build quality determines the result here. Luck plays a minimal role. Polish every slot."

---

### `wet_track`
**Format:** Normal race format, all entrants, wet surface conditions.

**Mechanics:**
- `event_fit` weights **Tires** at **×1.5** and **Suspension** at **×1.3**
- A build without Upgraded or Performance Tires suffers an `event_fit` penalty of −15 for wet grip deficiency
- Wear multiplier: **1.2×** (wet conditions increase degradation slightly)
- No special rule constraints

**Build advice visible to players:** "Tire quality dominates in wet conditions. A Standard Tire build will be significantly disadvantaged."

---

### `night_race`
**Format:** Normal race format, all entrants, night conditions.

**Mechanics:**
- `event_fit` weights **Electronics** at **×1.5**
- A build with Standard Electronics suffers an `event_fit` penalty of −10 for reduced data readout quality in low visibility
- Wear multiplier: **1.0×**
- No special rule constraints

**Build advice visible to players:** "Electronics tier gives a meaningful advantage here via improved sensors and data quality."

---

### `altitude`
**Format:** Normal race format, all entrants, high-altitude circuit.

**Mechanics:**
- `event_fit` weights **Suspension** at **×1.4** and **Aero** at **×1.3**
- Engine top speed is reduced at altitude: Engine contribution to `build_quality` is multiplied by **×0.8** for this event only
- Wear multiplier: **1.1×**
- No special rule constraints

**Build advice visible to players:** "Suspension and Aero matter more at altitude. High-end engines are partially wasted here."

---

### `spec_class`
**Format:** Normal race format with a **compliance check** before the race.

**Mechanics:**
- **Electronics compliance check:** If Electronics slot is Standard tier, the car passes with no penalty. If Upgraded or Performance, the car must pass a spec check — it always passes in prototype (compliance logic is a post-alpha feature)
- `event_fit` weights **Electronics** at **×1.4**
- In prototype, spec_class behaves identically to `night_race` from a scoring perspective, with Electronics bonus as the differentiator
- Wear multiplier: **1.0×**
- Future: non-compliant builds will be disqualified or have `result_score` zeroed

**Build advice visible to players:** "Electronics compliance is checked at entry. Electronics tier provides a scoring bonus."

---

### `weight_limit`
**Format:** Normal race format with a **maximum build weight** enforced.

**Mechanics:**
- Each slot has a prototype weight value (arbitrary units):

  | Slot | Standard | Upgraded | Performance |
  |------|----------|----------|-------------|
  | Engine | 10 | 14 | 18 |
  | Tires | 8 | 10 | 13 |
  | Suspension | 6 | 8 | 11 |
  | Aero | 5 | 7 | 10 |
  | Fuel | 9 | 11 | 15 |
  | Electronics | 4 | 6 | 9 |

- **Weight limit:** 70 units (all Standard = 42 units; headroom exists for selective upgrades)
- If total build weight exceeds 70 units, **Aero** and **Fuel** slot contributions are penalized by −10 each in `event_fit`
- Players can see their current build weight and the limit before entry
- Wear multiplier: **1.0×**

**Build advice visible to players:** "Aero and Fuel slots are penalized if you exceed the weight cap. Balance upgrades carefully."

---

## How event_fit is computed

For each event, the `event_fit` score is computed as:

```
event_fit = sum(slot_score[s] × weight[s] for s in slots) / normalizer
```

where:
- `slot_score[s]` is the part tier base score for slot `s` (Standard=40, Upgraded=70, Performance=100)
- `weight[s]` is the event-specific weight for that slot (default 1.0, boosted per event type above)
- `normalizer` scales the result to 0–100

Any event-specific penalties (wet grip, weight cap, etc.) are subtracted from the raw `event_fit` before it enters the performance formula.
