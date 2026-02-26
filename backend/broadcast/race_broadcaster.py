"""
In-memory fan-out broadcaster.

race_id → list of asyncio.Queue — one queue per connected WebSocket client.
The scheduler job pushes events in; each WebSocket handler drains its own queue.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict


class RaceBroadcaster:
    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, race_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues[race_id].append(q)
        return q

    def unsubscribe(self, race_id: str, q: asyncio.Queue) -> None:
        try:
            self._queues[race_id].remove(q)
        except ValueError:
            pass

    async def broadcast(self, race_id: str, message: dict) -> None:
        for q in list(self._queues[race_id]):
            await q.put(message)

    def subscriber_count(self, race_id: str) -> int:
        return len(self._queues[race_id])


# Singleton — imported directly by main.py and scheduler/jobs.py
broadcaster = RaceBroadcaster()
