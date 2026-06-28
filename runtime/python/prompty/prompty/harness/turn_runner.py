"""Run one deterministic harness turn using host-provided model callbacks."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from ..model import (
    Checkpoint,
    HostToolRequest,
    HostToolResult,
    PermissionDecision,
    PermissionRequest,
    SessionEvent,
    SessionSummary,
    TurnEvent,
    TurnOptions,
)

JsonRecord = dict[str, Any]
TurnStatus = Literal["success", "error"]


@dataclass
class TurnModelRequest:
    """Input passed to the injected model callback for one loop iteration."""

    session_id: str
    turn_id: str
    iteration: int
    inputs: JsonRecord
    options: TurnOptions
    tool_results: list[HostToolResult] = field(default_factory=list)


@dataclass
class TurnModelResponse:
    """Provider-agnostic model callback response consumed by the turn runner."""

    output: Any | None = None
    tool_requests: list[HostToolRequest] = field(default_factory=list)
    checkpoint_state: JsonRecord = field(default_factory=dict)


@dataclass
class RunTurnRequest:
    """Configuration for a single deterministic turn run."""

    session_id: str
    turn_id: str
    inputs: JsonRecord = field(default_factory=dict)
    options: TurnOptions = field(default_factory=TurnOptions)


@dataclass
class RunTurnResult:
    """Replayable result returned after a turn completes."""

    session_id: str
    turn_id: str
    status: TurnStatus
    iterations: int
    tool_results: list[HostToolResult] = field(default_factory=list)
    checkpoints: list[Checkpoint] = field(default_factory=list)
    output: Any | None = None


class EventSinkProtocol(Protocol):
    """Subset of EventSink used by the reference turn runner."""

    def emit_turn(self, turn_event: TurnEvent) -> bool: ...

    def emit_session(self, session_event: SessionEvent) -> bool: ...


class EventJournalWriterProtocol(Protocol):
    """Subset of EventJournalWriter used by the reference turn runner."""

    def append_turn(self, turn_event: TurnEvent) -> bool: ...

    def append_session(self, session_event: SessionEvent) -> bool: ...

    def close(self, summary: SessionSummary | None) -> bool: ...


class CheckpointStoreProtocol(Protocol):
    """Subset of CheckpointStore used by the reference turn runner."""

    async def save(self, checkpoint: Checkpoint) -> Checkpoint: ...


class PermissionResolverProtocol(Protocol):
    """Subset of PermissionResolver used by the reference turn runner."""

    async def request(self, request: PermissionRequest) -> PermissionDecision: ...


class HostToolExecutorProtocol(Protocol):
    """Subset of HostToolExecutor used by the reference turn runner."""

    async def execute(self, request: HostToolRequest) -> HostToolResult: ...


TurnModelCallback = Callable[[TurnModelRequest], TurnModelResponse | Awaitable[TurnModelResponse]]


class ReferenceTurnRunner:
    """Compose harness contracts to run one deterministic single-turn loop."""

    def __init__(
        self,
        *,
        event_sink: EventSinkProtocol,
        journal: EventJournalWriterProtocol,
        checkpoint_store: CheckpointStoreProtocol,
        permission_resolver: PermissionResolverProtocol,
        host_tool_executor: HostToolExecutorProtocol,
        invoke_model: TurnModelCallback,
        now: Callable[[], str] | None = None,
        next_id: Callable[[str], str] | None = None,
    ) -> None:
        self.event_sink = event_sink
        self.journal = journal
        self.checkpoint_store = checkpoint_store
        self.permission_resolver = permission_resolver
        self.host_tool_executor = host_tool_executor
        self.invoke_model = invoke_model
        self.now = now
        self.next_id = next_id
        self._sequence = 0

    async def run(self, request: RunTurnRequest) -> RunTurnResult:
        """Run one turn and return its deterministic, replayable result."""
        max_iterations = request.options.max_iterations if request.options.max_iterations is not None else 10
        checkpoints: list[Checkpoint] = []
        all_tool_results: list[HostToolResult] = []
        pending_tool_results: list[HostToolResult] = []
        output: Any | None = None
        status: TurnStatus = "success"
        iterations = 0

        self._record_session(
            "session_start",
            request.session_id,
            request.turn_id,
            {"sessionId": request.session_id, "schemaVersion": "1"},
        )
        self._record_turn(
            "turn_start",
            request.turn_id,
            0,
            {"inputs": request.inputs, "maxIterations": max_iterations},
        )

        for iteration in range(max_iterations):
            iterations = iteration + 1
            self._record_turn("llm_start", request.turn_id, iteration, {"attempt": 0})
            response = self.invoke_model(
                TurnModelRequest(
                    session_id=request.session_id,
                    turn_id=request.turn_id,
                    iteration=iteration,
                    inputs=request.inputs,
                    options=request.options,
                    tool_results=pending_tool_results,
                )
            )
            if inspect.isawaitable(response):
                response = await response
            self._record_turn("llm_complete", request.turn_id, iteration, {})

            checkpoint = await self._save_checkpoint(request.session_id, request.turn_id, iteration, response)
            checkpoints.append(checkpoint)

            if not response.tool_requests:
                output = response.output
                break

            pending_tool_results = []
            for tool_request in response.tool_requests:
                tool_result = await self._resolve_and_execute_tool(request.turn_id, iteration, tool_request)
                pending_tool_results.append(tool_result)
                all_tool_results.append(tool_result)

            self._record_turn(
                "messages_updated",
                request.turn_id,
                iteration,
                {"toolResults": [result.save() for result in pending_tool_results]},
            )

        if output is None and pending_tool_results:
            status = "error"
            output = {"message": "Maximum turn iterations reached"}
            self._record_turn(
                "error",
                request.turn_id,
                iterations,
                {"errorKind": "max_iterations", "message": "Maximum turn iterations reached"},
            )

        self._record_turn(
            "turn_end",
            request.turn_id,
            iterations,
            {"iterations": iterations, "status": status, "response": output},
        )
        self._record_session(
            "session_end",
            request.session_id,
            request.turn_id,
            {"sessionId": request.session_id, "status": status, "reason": "turn_complete"},
        )
        self.journal.close(
            SessionSummary(
                session_id=request.session_id,
                status=status,
                turns=1,
                checkpoints=len(checkpoints),
            )
        )

        return RunTurnResult(
            session_id=request.session_id,
            turn_id=request.turn_id,
            status=status,
            output=output,
            iterations=iterations,
            tool_results=all_tool_results,
            checkpoints=checkpoints,
        )

    async def _save_checkpoint(
        self,
        session_id: str,
        turn_id: str,
        iteration: int,
        response: TurnModelResponse,
    ) -> Checkpoint:
        checkpoint = Checkpoint(
            id=f"{turn_id}-checkpoint-{iteration}",
            session_id=session_id,
            turn_id=turn_id,
            checkpoint_number=iteration + 1,
            title=f"Turn {turn_id} iteration {iteration}",
            state={
                "iteration": iteration,
                "output": response.output,
                "toolRequests": [tool_request.save() for tool_request in response.tool_requests],
                **response.checkpoint_state,
            },
            created_at=self._timestamp(),
        )
        saved = await self.checkpoint_store.save(checkpoint)
        self._record_session(
            "checkpoint_created",
            session_id,
            turn_id,
            {"checkpointId": saved.id, "checkpointNumber": saved.checkpoint_number},
        )
        return saved

    async def _resolve_and_execute_tool(
        self,
        turn_id: str,
        iteration: int,
        tool_request: HostToolRequest,
    ) -> HostToolResult:
        permission = PermissionRequest(
            request_id=f"{tool_request.request_id}-permission" if tool_request.request_id else self._id("permission"),
            tool_call_id=tool_request.tool_call_id,
            permission="tool.execute",
            target=tool_request.tool_name,
            details=tool_request.save(),
        )
        self._record_turn("permission_requested", turn_id, iteration, permission.save())
        decision = await self.permission_resolver.request(permission)
        self._record_turn("permission_completed", turn_id, iteration, decision.save())

        if not decision.approved:
            return HostToolResult(
                request_id=tool_request.request_id,
                tool_call_id=tool_request.tool_call_id,
                tool_name=tool_request.tool_name,
                success=False,
                error_kind="permission_denied",
                result={"message": decision.reason or "Permission denied"},
            )

        self._record_turn("tool_execution_start", turn_id, iteration, tool_request.save())
        result = await self.host_tool_executor.execute(tool_request)
        self._record_turn("tool_execution_complete", turn_id, iteration, result.save())
        self._record_turn("tool_result", turn_id, iteration, result.save())
        return result

    def _record_turn(self, event_type: Any, turn_id: str, iteration: int, payload: JsonRecord) -> None:
        event = TurnEvent(
            id=self._id("turn-event"),
            type=event_type,
            timestamp=self._timestamp(),
            turn_id=turn_id,
            iteration=iteration,
            payload=payload,
        )
        self.event_sink.emit_turn(event)
        self.journal.append_turn(event)

    def _record_session(self, event_type: Any, session_id: str, turn_id: str, payload: JsonRecord) -> None:
        event = SessionEvent(
            id=self._id("session-event"),
            type=event_type,
            timestamp=self._timestamp(),
            session_id=session_id,
            turn_id=turn_id,
            payload=payload,
        )
        self.event_sink.emit_session(event)
        self.journal.append_session(event)

    def _timestamp(self) -> str:
        if self.now is not None:
            return self.now()
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")

    def _id(self, prefix: str) -> str:
        if self.next_id is not None:
            return self.next_id(prefix)
        self._sequence += 1
        return f"{prefix}-{self._sequence}"
