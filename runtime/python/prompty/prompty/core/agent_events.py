"""Agent event types for the §13 agent loop extensions.

Defines the event callback signature and event helper for emitting
structured events during agent loop execution.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

__all__ = [
    "AgentEvent",
    "EventCallback",
    "emit_event",
]


@dataclass
class AgentEvent:
    """A structured event emitted during agent loop execution.

    Attributes
    ----------
    type:
        The event discriminator — one of ``token``, ``thinking``,
        ``tool_call_start``, ``tool_result``, ``status``,
        ``messages_updated``, ``done``, ``error``, ``cancelled``.
    data:
        Payload dict whose keys depend on the event type.
    """

    type: str
    data: dict[str, Any]


# Callback signature: (event_type, data) → None.  Must not throw.
EventCallback = Callable[[str, dict[str, Any]], None]


def emit_event(
    callback: EventCallback | None,
    event_type: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Safely invoke an event callback, swallowing any exceptions.

    Per spec §13.1, event callbacks MUST NOT block the loop. If a callback
    raises, we log and continue.
    """
    if callback is None:
        return
    try:
        payload = data or {}
        event_data = dict(payload)
        event_data.setdefault(
            "turnEvent",
            {
                "id": f"evt_{uuid4().hex}",
                "type": event_type,
                "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "iteration": payload.get("iteration") if isinstance(payload.get("iteration"), int) else None,
                "payload": payload,
            },
        )
        callback(event_type, event_data)
    except Exception as exc:  # noqa: BLE001 — spec says log and continue
        import logging

        logging.getLogger("prompty.events").debug("Event callback error for %s: %s", event_type, exc)
