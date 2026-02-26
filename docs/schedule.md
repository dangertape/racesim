# Race Schedule & Event Structure

This document covers how races are organized in time, what differentiates events, and how commitment creates stakes.

---

## Scheduled Events

Races happen at **fixed UTC wall-clock times** — the real-world clock, not an in-game timer. Races fire on schedule regardless of player activity.

**Default cadence: 144 fixed slots spread across 24 hours**, one race every 10 minutes. The exact slot times, event types, lap counts, and track grid sizes are all defined in `data/schedule.json`.

Example slots (UTC): 00:00, 00:10, 00:20, 00:30, … 23:40, 23:50

**Each slot has a pre-assigned event type, lap count, and grid size** so that different builds, race lengths, and track sizes have their moment across the day. The full day's schedule is visible in advance — players can see every upcoming race and decide which ones to target.

### Per-slot parameters

Every slot in `data/schedule.json` carries three fields beyond the time and event type:

| Field | Type | Range | Effect |
|-------|------|-------|--------|
| `event_type` | string | 8 types | Which scoring modifiers and wear rules apply |
| `lap_count` | integer | 25 – 250 | How many laps the race runs; also controls how long a race "feels" to watch |
| `grid_size` | integer | 12 – 60 | The N×N dimension of the randomly generated track; larger = more complex layout |

`lap_count` and `grid_size` are correlated with event type and increase across the day:

| Event type | `lap_count` range | `grid_size` range |
|------------|-------------------|-------------------|
| `sprint` | 25 – 75 | 12 – 24 |
| `time_trial` | 25 – 50 | 12 – 18 |
| `wet_track` | 50 – 100 | 18 – 36 |
| `night_race` | 50 – 100 | 18 – 36 |
| `spec_class` | 50 – 100 | 18 – 36 |
| `weight_limit` | 75 – 125 | 24 – 48 |
| `altitude` | 75 – 150 | 24 – 48 |
| `endurance` | 150 – 250 | 36 – 60 |

This structure creates:
- A natural **prep window** before each race — the 10-minute gap between races is the prep window
- A reason to **plan ahead** — players can look at the day's lineup and build toward a specific event
- A range of race lengths: a quick sprint at 25 laps, an epic endurance at 250 laps
- Low stakes for missing any individual race — another one starts every 10 minutes

### Schedule design rules:
- The full day's schedule is always visible so players can plan
- No two adjacent slots share the same event type
- Missing a race is low-stakes — the cycle repeats every 10 minutes
- Races are player-only — there are no AI or NPC competitors; if few players enter, the race runs with whoever signed up

---

## Event Differentiation

Each race emphasizes different strengths. This is the primary mechanism that prevents one optimal build.

### Events vary by:

| Axis | Examples |
|------|----------|
| **Environment/conditions** | Wet track, altitude, night race, surface type |
| **Rule constraints** | Weight limit, part restrictions, spec requirements |
| **Length/format** | Sprint (high risk tolerance), endurance (wear matters more), time trial |

### Design intent:
- Each event type should make a different subset of builds shine
- Players should be able to read an event listing and reason about what build fits
- "Match the car to the event" is a core skill — events must be legible enough to enable it

For full mechanical definitions of each event type, see `docs/event_types.md`.

---

## Commitment Mechanic

Once a player **enters a race, their build is locked** for that event.

### What this achieves:
- Preparation is meaningful — you can't adjust last-second
- The decision to enter is itself a strategic choice
- Prevents reaction gameplay from dominating (no optimizing after seeing opponents)

### Commitment edge cases (resolved)

**Can't repair in time:**
The player may enter with degraded readiness — there is no forced entry and no penalty for sitting out. Readiness penalties are applied to the result if the player chooses to race with a degraded car. Sitting out is always a valid option with no penalty beyond losing the entry fee *if the player has already paid it* (see withdrawal below).

**Multiple events in the same window:**
Not possible. Slots are sequential (one every 10 minutes) and a player is never in two races simultaneously. Each prep window belongs to exactly one upcoming race.

**Withdrawal:**
A player may withdraw from a race up to **10 minutes before the scheduled start time**. Withdrawing after paying the entry fee forfeits **50% of the entry fee** (the other 50% is returned). Withdrawing before paying the entry fee has no cost. After the 10-minute cutoff, the entry is locked and no refund is issued.

---

## Event Information (What Players Can See Pre-Race)

Players should be able to see enough to make informed decisions, but not so much that prep is trivial.

### Visible before entry:
- Race type and format
- Environment/conditions (weather, surface)
- Known rule constraints
- Historical results (what builds tended to do well)

### Hidden until race:
- Exact competitor builds
- Precise luck outcomes (obviously)
- Specific incident events
