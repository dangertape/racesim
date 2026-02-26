"""
Random-walk track generation.

Algorithm:
1. Start at a fixed cell, walk randomly on an N×N grid without revisiting cells.
2. When adjacent to start (after ≥ 8 steps) close the loop and return.
3. Retry up to MAX_RETRIES times; fall back to a hardcoded oval if all fail.
4. Annotate each tile with type (straight / curve / chicane) and orientation.
"""
from __future__ import annotations

import random
from typing import Optional

from backend.config import TRACK_GRID_SIZE, TRACK_MIN_STEPS, TRACK_MAX_RETRIES
from backend.models import TileData, TrackData

# (dx, dy) → compass label when moving in that direction
_COMPASS = {(1, 0): "E", (-1, 0): "W", (0, 1): "S", (0, -1): "N"}

# Which two compass labels a curve orientation connects
_CURVE_DIRS: dict[frozenset, str] = {
    frozenset({"N", "E"}): "NE",
    frozenset({"N", "W"}): "NW",
    frozenset({"S", "E"}): "SE",
    frozenset({"S", "W"}): "SW",
}


def _tile_type_orientation(came_from_delta: tuple, going_to_delta: tuple) -> tuple[str, str]:
    """Return (tile_type, orientation) for a cell given entry and exit directions."""
    if came_from_delta == going_to_delta:
        # Straight
        if came_from_delta[0] != 0:
            return "straight", "horizontal"
        return "straight", "vertical"
    # Curve — choose chicane if zig-zag (anti-parallel), otherwise normal curve
    from_label = _COMPASS[came_from_delta]
    to_label   = _COMPASS[going_to_delta]
    key = frozenset({from_label, to_label})
    if key in _CURVE_DIRS:
        return "curve", _CURVE_DIRS[key]
    # Shouldn't happen on a proper walk; default to straight
    return "straight", "horizontal"


def _build_track_data(path: list[tuple[int, int]], n: int) -> TrackData:
    """Convert a closed path list into a TrackData object.

    path[0] == path[-1]; path_order excludes the trailing duplicate.
    """
    path_order = path[:-1]
    tiles: list[TileData] = []
    m = len(path_order)
    for i, (x, y) in enumerate(path_order):
        prev = path_order[(i - 1) % m]
        nxt  = path_order[(i + 1) % m]
        came_from = (x - prev[0], y - prev[1])
        going_to  = (nxt[0] - x,  nxt[1] - y)
        t_type, t_orient = _tile_type_orientation(came_from, going_to)
        tiles.append(TileData(x=x, y=y, type=t_type, orientation=t_orient))

    return TrackData(
        grid_width=n,
        grid_height=n,
        tiles=tiles,
        path_order=[[x, y] for x, y in path_order],
    )


def _try_walk(n: int, rng: random.Random) -> Optional[list[tuple[int, int]]]:
    """Attempt one random-walk closed loop. Returns path list or None."""
    max_steps  = n * n          # upper bound scales with grid area
    min_steps  = max(TRACK_MIN_STEPS, n * 2)
    start = (0, 0)
    visited: set[tuple[int, int]] = {start}
    path = [start]
    current = start

    for _ in range(max_steps):
        # Try to close the loop once we have enough steps
        if len(path) >= min_steps:
            for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                nx, ny = current[0] + dx, current[1] + dy
                if (nx, ny) == start:
                    path.append(start)
                    return path

        # Collect unvisited neighbours
        candidates = []
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nx, ny = current[0] + dx, current[1] + dy
            if 0 <= nx < n and 0 <= ny < n and (nx, ny) not in visited:
                candidates.append((nx, ny))

        if not candidates:
            return None  # stuck

        nxt = rng.choice(candidates)
        visited.add(nxt)
        path.append(nxt)
        current = nxt

    return None


def _oval_fallback(n: int) -> TrackData:
    """Generate a simple rectangular oval for any n×n grid (n ≥ 4)."""
    lo, hi = 1, n - 2   # leave a 1-cell border
    path: list[tuple[int, int]] = []
    path += [(x, lo) for x in range(lo, hi + 1)]          # top edge →
    path += [(hi, y) for y in range(lo + 1, hi + 1)]      # right edge ↓
    path += [(x, hi) for x in range(hi - 1, lo - 1, -1)]  # bottom edge ←
    path += [(lo, y) for y in range(hi - 1, lo, -1)]      # left edge ↑
    path.append(path[0])                                   # close loop
    return _build_track_data(path, n)


def generate_track(n: int = TRACK_GRID_SIZE, seed: Optional[int] = None) -> TrackData:
    """Generate a random closed-loop track on an N×N grid."""
    rng = random.Random(seed)
    for _ in range(TRACK_MAX_RETRIES):
        path = _try_walk(n, rng)
        if path:
            return _build_track_data(path, n)
    return _oval_fallback(n)
