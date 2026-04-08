"""Cooperative cancellation token for the agent loop.

Wraps a ``threading.Event`` for thread-safe cancellation signalling.
"""

from __future__ import annotations

import threading

__all__ = [
    "CancellationToken",
    "CancelledError",
]


class CancelledError(Exception):
    """Raised when the agent loop is cancelled via a CancellationToken."""


class CancellationToken:
    """A thread-safe cooperative cancellation token.

    Share between the caller (who calls :meth:`cancel`) and the agent loop
    (which checks :meth:`is_cancelled` at well-defined points).

    Example
    -------
    >>> token = CancellationToken()
    >>> token.is_cancelled
    False
    >>> token.cancel()
    >>> token.is_cancelled
    True
    """

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        """Signal cancellation.  All references to this token observe it."""
        self._event.set()

    @property
    def is_cancelled(self) -> bool:
        """Whether cancellation has been requested."""
        return self._event.is_set()

    def reset(self) -> None:
        """Reset the token to non-cancelled state (for reuse)."""
        self._event.clear()
