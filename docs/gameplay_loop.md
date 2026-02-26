# Gameplay Loop

The core loop has three distinct phases. All meaningful player agency is front-loaded into the **prep phase**.

---

## Phase 1: Between Races (Player Agency)

This is where the game is "played."

Players:
- Review upcoming races — what's coming, what each event tends to reward
- Improve their car — swap parts, upgrade, repair
- Manage resources — money, materials, time
- Choose which event(s) to enter and **commit** their build

**Design intent:** All meaningful choices happen here. The player wins or loses based on how well they allocate limited resources and make tradeoffs in preparation.

---

## Phase 2: During Race (No Active Input)

Once a race starts, the player has **no control**.

- The game simulates performance and produces a watchable, understandable outcome
- The race plays out as the *test* of the decisions made beforehand

**Design intent:** The race is validation, not gameplay. It should be satisfying to watch but require nothing from the player.

### Race Viewer (Three.js isometric)

The watch screen renders the race as a **shared live broadcast** — every connected viewer watches the same scene at the same moment, regardless of whether they entered the race or not.

- The race is a single server-side event; all clients receive the same WebSocket tick stream simultaneously
- There is no per-player replay or scrubbing — if you open the viewer mid-race, you join at the current point, like tuning into a live stream
- An `OrthographicCamera` at a fixed iso angle looks down at the track; there is no player-controlled camera
- Car models are loaded from `car.glb` (shared GLB asset, cloned per competitor); tint distinguishes competitors
- Cars move along a `CatmullRomCurve3` track path, driven by `position_on_track` values from the WebSocket event stream
- Incident events (spins, mechanical failures) surface as brief procedural animations on the affected car before it resumes
- The viewer is read-only and decorative — it visualises the same event stream used by the text log, adding no new game information

See `docs/stack.md` → *Race Viewer — Three.js* for the technical implementation detail.

---

## Phase 3: After Race (Feedback + New Constraints)

After results are displayed:

- Player receives rewards: progress, currency, items, standings
- Car state changes: wear, damage, and consumption create new decisions
- The game explains what mattered in plain terms

**Design intent:** The post-race phase creates a **new planning problem** for the next race, restarting the loop with updated constraints.

---

## Loop Integrity Rules

- A player who skips prep should perform worse than one who engages — not identically
- Feedback must be specific enough to change future decisions, not just show a score
- The gap between races must feel like meaningful time, not empty waiting
