# Simulation Mechanics

This document covers the *how* of the race simulation: what inputs go in, how they combine, and how randomness is controlled.

---

## Performance Model

Race outcome is a function of four inputs:

| Input | Description | Player Control |
|-------|-------------|----------------|
| **Build quality** | What parts are installed and how well they're configured | Full |
| **Event fit** | How well the build matches this specific race's demands | Full (via prep) |
| **Readiness** | Maintenance level and wear state of the car | Full |
| **Luck** | Bounded randomness representing race incidents | None |

### Performance Formula

```
result_score = (build_quality × 0.4) + (event_fit × 0.35) + (readiness × 0.25) + luck_delta
```

- All three primary inputs (`build_quality`, `event_fit`, `readiness`) are normalized to the range **0–100**
- `luck_delta` ∈ **[−15, +15]** — drawn uniformly from a bounded distribution
- `result_score` range before luck: 0–100; with luck applied: −15 to 115 (clamped to 0–100 for display)
- **Finishing position** is determined by ranking all entrants by `result_score` descending (highest score = 1st place)

#### Input definitions

| Variable | How it's computed |
|----------|-------------------|
| `build_quality` | Weighted sum of each installed slot's tier value (Standard=40, Upgraded=70, Performance=100), normalized across 6 slots |
| `event_fit` | Sum of event-type modifier bonuses for each slot; see `event_types.md` for per-event weights |
| `readiness` | Average readiness % across all 6 slots (0–100); readiness below 50% applies a per-slot penalty before averaging |

---

## Luck System

Luck exists to create stories and prevent determinism, not to punish players arbitrarily.

### Luck must:
- Be **bounded** — `luck_delta` is always within ±15 points; it cannot override a large build advantage
- Be **explainable** — the game narrates what happened ("a mechanical issue on lap 3", "a perfect run through sector 2")
- Generate **narrative events**, not just a modifier number

### Luck must not:
- Override a large build or readiness advantage (a 30-point lead cannot be erased by luck alone)
- Feel opaque or random without context
- Be gameable (no save-scumming equivalent)

### Luck in time trials
For `time_trial` events, luck is compressed to **±5** to reflect the controlled, solo format.

---

## Post-Race Explanation

After every race, the game answers three questions clearly and shows a **breakdown screen** with these data fields:

### Breakdown screen fields

| Field | Description |
|-------|-------------|
| **Finishing position** | 1st, 2nd, … Nth out of N entrants |
| **result_score** | Final numeric score (0–100) |
| **Per-slot contribution** | Each of the 6 slots shown with its individual contribution to `build_quality` |
| **event_fit score** | The raw `event_fit` value (0–100) with which modifiers applied and why |
| **Luck roll** | The exact `luck_delta` value drawn, plus a narrative tag (e.g., "Mechanical incident –8", "Clean run +11") |
| **Counterfactual position** | "With neutral luck (luck_delta = 0) you would have finished Nth" |
| **Readiness penalties** | Any slots that were below 50% readiness and the penalty applied |

### The three questions answered:

1. **"What aspects of my build mattered here?"**
   — Highlight which slots had the highest per-slot contribution to the result

2. **"What event conditions influenced the result?"**
   — Show how the event type amplified or penalized specific slots (event_fit breakdown)

3. **"What was skillful planning vs. bad luck?"**
   — The counterfactual position separates player contribution from randomness

This feedback loop is the primary teaching mechanism. It must be honest, even when the result is unflattering to the player.

---

## Simulation Output

The simulation produces:
- A **finishing position** (1st, 2nd, … Nth) as the primary outcome metric
- A `result_score` for each entrant used to determine rank
- A tick stream of car states — `{ car_id, position_on_track, speed, incident }` — emitted over WebSocket as the race runs; consumed by both the text log and the Three.js isometric viewer
- A readable replay or event log (not frame-by-frame, more like key moments)
- A breakdown screen per the post-race explanation above
