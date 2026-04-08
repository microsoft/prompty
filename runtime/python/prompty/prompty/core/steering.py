"""Steering — inject user messages into a running agent loop.

The :class:`Steering` handle lets external code push messages that the
runner drains and appends as user messages before the next LLM call.

Thread-safe: :meth:`send` can be called from any thread or async task.
"""

from __future__ import annotations

import threading

from .types import Message, TextPart

__all__ = [
    "Steering",
]


class Steering:
    """A thread-safe handle for injecting user messages into a running agent loop.

    Example
    -------
    >>> steering = Steering()
    >>> steering.send("Actually, focus on error handling")
    >>> steering.has_pending
    True
    >>> messages = steering.drain()
    >>> len(messages)
    1
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queue: list[str] = []

    def send(self, message: str) -> None:
        """Enqueue a message to be injected at the next iteration."""
        with self._lock:
            self._queue.append(message)

    def drain(self) -> list[Message]:
        """Atomically remove and return all queued messages as Message objects."""
        with self._lock:
            items = self._queue.copy()
            self._queue.clear()
        return [Message(role="user", parts=[TextPart(value=text)]) for text in items]

    @property
    def has_pending(self) -> bool:
        """Whether there are pending messages without consuming them."""
        with self._lock:
            return len(self._queue) > 0
