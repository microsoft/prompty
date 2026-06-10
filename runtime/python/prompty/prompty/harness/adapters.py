"""Implement dependency-free reference adapters for harness protocols."""

from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from time import perf_counter
from typing import Any

from ..model import (
    Checkpoint,
    HostToolRequest,
    HostToolResult,
    PermissionDecision,
    PermissionRequest,
    SessionEvent,
    SessionSummary,
    TurnEvent,
)

ToolHandler = Callable[[dict[str, Any], HostToolRequest], Any | Awaitable[Any]]


def _checkpoint_key(session_id: str, checkpoint_id: str) -> tuple[str, str]:
    return (session_id, checkpoint_id)


def _require_checkpoint_key(checkpoint: Checkpoint) -> tuple[str, str]:
    if not checkpoint.session_id:
        raise ValueError("Checkpoint session_id is required")
    if not checkpoint.id:
        raise ValueError("Checkpoint id is required")
    return _checkpoint_key(checkpoint.session_id, checkpoint.id)


def _error_message(error: BaseException) -> str:
    return str(error)


class CollectingEventSink:
    """Capture emitted turn and session events in memory."""

    def __init__(self) -> None:
        self.turn_events: list[TurnEvent] = []
        self.session_events: list[SessionEvent] = []

    def emit_turn(self, turn_event: TurnEvent) -> bool:
        """Append a turn event."""
        self.turn_events.append(turn_event)
        return True

    def emit_session(self, session_event: SessionEvent) -> bool:
        """Append a session event."""
        self.session_events.append(session_event)
        return True


class JsonlTraceWriter:
    """Append replayable trace records as newline-delimited JSON."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._closed = False

    def append_turn(self, turn_event: TurnEvent) -> bool:
        """Append a turn event record."""
        return self._write({"kind": "turn", "event": turn_event.save()})

    def append_session(self, session_event: SessionEvent) -> bool:
        """Append a session event record."""
        return self._write({"kind": "session", "event": session_event.save()})

    def close(self, summary: SessionSummary | None) -> bool:
        """Append an optional summary and close the writer."""
        if summary is not None:
            if not self._write({"kind": "summary", "summary": summary.save()}):
                return False
        self._closed = True
        return True

    def _write(self, record: dict[str, Any]) -> bool:
        if self._closed:
            return False
        with self.path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(record, separators=(",", ":")))
            file.write("\n")
        return True


class InMemoryCheckpointStore:
    """Store checkpoints in memory by session and checkpoint identifier."""

    def __init__(self) -> None:
        self._checkpoints: dict[tuple[str, str], Checkpoint] = {}

    async def save(self, checkpoint: Checkpoint) -> Checkpoint:
        """Persist a checkpoint in memory."""
        self._checkpoints[_require_checkpoint_key(checkpoint)] = checkpoint
        return checkpoint

    async def load(self, session_id: str, checkpoint_id: str) -> Checkpoint | None:
        """Load a checkpoint by identifiers."""
        return self._checkpoints.get(_checkpoint_key(session_id, checkpoint_id))

    async def list_checkpoints(self, session_id: str) -> list[Checkpoint]:
        """List checkpoints for a session."""
        return [checkpoint for checkpoint in self._checkpoints.values() if checkpoint.session_id == session_id]


class AllowAllPermissionResolver:
    """Resolve every permission request as approved."""

    async def request(self, request: PermissionRequest) -> PermissionDecision:
        """Return an approved permission decision."""
        return PermissionDecision(
            request_id=request.request_id,
            tool_call_id=request.tool_call_id,
            permission=request.permission,
            approved=True,
            reason="allow_all",
        )


class DenyAllPermissionResolver:
    """Resolve every permission request as denied."""

    async def request(self, request: PermissionRequest) -> PermissionDecision:
        """Return a denied permission decision."""
        return PermissionDecision(
            request_id=request.request_id,
            tool_call_id=request.tool_call_id,
            permission=request.permission,
            approved=False,
            reason="deny_all",
        )


class FunctionHostToolExecutor:
    """Dispatch host tool requests to registered local callables."""

    def __init__(self, handlers: dict[str, ToolHandler]) -> None:
        self.handlers = handlers

    async def execute(self, request: HostToolRequest) -> HostToolResult:
        """Execute a registered host tool callable."""
        started = perf_counter()
        handler = self.handlers.get(request.tool_name)
        if handler is None:
            return HostToolResult(
                request_id=request.request_id,
                tool_call_id=request.tool_call_id,
                tool_name=request.tool_name,
                success=False,
                error_kind="not_found",
                result={"message": f"No host tool registered for '{request.tool_name}'"},
                duration_ms=(perf_counter() - started) * 1000,
            )

        try:
            result = handler(request.arguments or {}, request)
            if inspect.isawaitable(result):
                result = await result
            return HostToolResult(
                request_id=request.request_id,
                tool_call_id=request.tool_call_id,
                tool_name=request.tool_name,
                success=True,
                result=result,
                duration_ms=(perf_counter() - started) * 1000,
            )
        except Exception as error:
            return HostToolResult(
                request_id=request.request_id,
                tool_call_id=request.tool_call_id,
                tool_name=request.tool_name,
                success=False,
                error_kind="exception",
                result={"message": _error_message(error)},
                duration_ms=(perf_counter() - started) * 1000,
            )
