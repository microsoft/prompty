"""Run durable provider-neutral turns with Typra-emitted engine contracts."""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from ..core.cancellation import CancellationToken
from ..model import (
    EngineCheckpoint,
    EngineEvent,
    EnginePermissionDecision,
    InvocationContextState,
    Message,
    ModelInvocationContextSnapshot,
    ModelInvocationRequest,
    ModelInvocationResponse,
    ModelReconciliationState,
    ModelToolRequest,
    ModelToolResult,
    ResumeContext,
    SaveContext,
    TextPart,
    TurnCommit,
    TurnEngineResult,
)

__all__ = ["ReferenceTurnEngine", "load_engine_checkpoint", "save_engine_checkpoint"]

_DEFAULT_MAX_ITERATIONS = 10
_T = TypeVar("_T")

ModelCallback = Callable[[ModelInvocationRequest], ModelInvocationResponse | Awaitable[ModelInvocationResponse]]
ToolCallback = Callable[[ModelToolRequest], ModelToolResult | Awaitable[ModelToolResult]]
PermissionCallback = Callable[
    [ModelToolRequest], EnginePermissionDecision | bool | Awaitable[EnginePermissionDecision | bool]
]
EventCallback = Callable[[EngineEvent], object | Awaitable[object]]
CheckpointCallback = Callable[[EngineCheckpoint], object | Awaitable[object]]
PostCommitCallback = Callable[[TurnCommit], object | Awaitable[object]]
Clock = Callable[[], str]
IdFactory = Callable[[str], str]


async def _resolve(value: _T | Awaitable[_T]) -> _T:
    if inspect.isawaitable(value):
        return await value
    return value


def _default_clock() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class _SequentialIds:
    def __init__(self) -> None:
        self._value = 0

    def __call__(self, kind: str) -> str:
        self._value += 1
        return f"{kind}-{self._value}"


class _TurnCancelled(Exception):
    pass


def save_engine_checkpoint(checkpoint: EngineCheckpoint) -> dict[str, Any]:
    """Serialize a checkpoint without collapsing ordered duplicate tool names."""
    return checkpoint.save(SaveContext(collection_format="array"))


def load_engine_checkpoint(data: dict[str, Any]) -> EngineCheckpoint:
    """Load a checkpoint serialized by :func:`save_engine_checkpoint`."""
    return EngineCheckpoint.load(data)


class ReferenceTurnEngine:
    """Execute deterministic turns using the emitted engine model as the public boundary."""

    def __init__(
        self,
        *,
        invoke_model: ModelCallback,
        execute_tool: ToolCallback,
        authorize: PermissionCallback | None = None,
        on_event: EventCallback | None = None,
        save_checkpoint: CheckpointCallback | None = None,
        post_commit: PostCommitCallback | None = None,
        now: Clock | None = None,
        next_id: IdFactory | None = None,
    ) -> None:
        self._invoke_model = invoke_model
        self._execute_tool = execute_tool
        self._authorize = authorize
        self._on_event = on_event
        self._save_checkpoint = save_checkpoint
        self._post_commit = post_commit
        self._now = now or _default_clock
        self._next_id = next_id or _SequentialIds()
        self._sequence = 0
        self._session_id = ""
        self._turn_id = ""
        self._run_id = ""
        self._parent_run_id: str | None = None
        self._delegation_depth = 0

    def run(
        self,
        session_id: str,
        turn_id: str,
        messages: list[Message],
        *,
        inputs: Any | None = None,
        max_iterations: int = _DEFAULT_MAX_ITERATIONS,
        cancellation: CancellationToken | None = None,
        run_id: str | None = None,
        parent_run_id: str | None = None,
        delegation_depth: int = 0,
    ) -> TurnEngineResult:
        """Run a new turn synchronously."""
        return asyncio.run(
            self.run_async(
                session_id,
                turn_id,
                messages,
                inputs=inputs,
                max_iterations=max_iterations,
                cancellation=cancellation,
                run_id=run_id,
                parent_run_id=parent_run_id,
                delegation_depth=delegation_depth,
            )
        )

    async def run_async(
        self,
        session_id: str,
        turn_id: str,
        messages: list[Message],
        *,
        inputs: Any | None = None,
        max_iterations: int = _DEFAULT_MAX_ITERATIONS,
        cancellation: CancellationToken | None = None,
        run_id: str | None = None,
        parent_run_id: str | None = None,
        delegation_depth: int = 0,
    ) -> TurnEngineResult:
        """Run a new turn and return its emitted commit, snapshots, and tool results."""
        self._start_run(
            session_id,
            turn_id,
            run_id=run_id,
            parent_run_id=parent_run_id,
            delegation_depth=delegation_depth,
        )
        await self._emit("turn_started")
        return await self._drive(
            messages=list(messages),
            inputs=inputs,
            max_iterations=max_iterations,
            cancellation=cancellation,
            iteration=0,
            stable_prefix_messages=len(messages),
            context_state=InvocationContextState(),
            snapshots=[],
            tool_results=[],
        )

    def resume(
        self,
        context: ResumeContext,
        *,
        cancellation: CancellationToken | None = None,
    ) -> TurnEngineResult:
        """Resume a durable checkpoint synchronously without repeating committed effects."""
        return asyncio.run(self.resume_async(context, cancellation=cancellation))

    async def resume_async(
        self,
        context: ResumeContext,
        *,
        cancellation: CancellationToken | None = None,
    ) -> TurnEngineResult:
        """Resume a durable checkpoint without repeating committed model or tool effects."""
        checkpoint = context.checkpoint
        self._session_id = checkpoint.session_id
        self._turn_id = checkpoint.turn_id
        self._run_id = checkpoint.run_id or self._next_id("run")
        self._parent_run_id = checkpoint.parent_run_id
        self._delegation_depth = checkpoint.delegation_depth
        self._sequence = max(checkpoint.last_sequence, context.last_journal_sequence)
        await self._emit("turn_started", payload={"resumedFrom": checkpoint.id})

        max_iterations = context.max_iterations
        snapshots: list[ModelInvocationContextSnapshot] = []
        tool_results = list(checkpoint.completed_tool_results)
        messages = list(checkpoint.messages)
        context_state = checkpoint.context_state

        if checkpoint.reconciliation_required:
            return await self._reconciliation_required(
                messages=messages,
                iterations=checkpoint.completed_model_iterations,
                context_state=context_state,
                snapshots=snapshots,
                tool_results=tool_results,
                model_reconciliation=checkpoint.model_reconciliation,
            )

        if cancellation is not None and cancellation.is_cancelled:
            await self._emit("turn_cancelled", iteration=checkpoint.iteration)
            return self._cancelled(
                messages,
                checkpoint.completed_model_iterations,
                context_state,
                snapshots,
                tool_results,
                model_reconciliation=checkpoint.model_reconciliation,
            )

        if checkpoint.final_output_ready:
            return await self._commit(
                status="success",
                output=checkpoint.pending_output,
                messages=messages,
                iterations=checkpoint.completed_model_iterations,
                context_state=context_state,
                snapshots=snapshots,
                tool_results=tool_results,
            )

        if checkpoint.pending_tool_requests:
            response = checkpoint.pending_model_response or ModelInvocationResponse()
            pending_ids = {request.id for request in checkpoint.pending_tool_requests}
            completed_round_results = [result for result in tool_results if result.request_id in pending_ids]
            try:
                new_results = await self._execute_pending_tools(
                    checkpoint.pending_tool_requests,
                    tool_results,
                    iteration=checkpoint.iteration,
                    cancellation=cancellation,
                    messages=messages,
                    inputs=checkpoint.inputs,
                    context_state=context_state,
                    response=response,
                    stable_prefix_messages=checkpoint.stable_prefix_messages,
                    active_invocation_id=checkpoint.active_invocation_id,
                )
            except _TurnCancelled:
                await self._emit("turn_cancelled", iteration=checkpoint.iteration)
                return self._cancelled(
                    messages,
                    checkpoint.completed_model_iterations,
                    context_state,
                    snapshots,
                    tool_results,
                )
            tool_results.extend(new_results)
            if any(result.outcome == "indeterminate" for result in new_results):
                return await self._reconciliation_required(
                    messages=messages,
                    iterations=checkpoint.completed_model_iterations,
                    context_state=context_state,
                    snapshots=snapshots,
                    tool_results=tool_results,
                )
            round_results = self._ordered_round_results(
                checkpoint.pending_tool_requests,
                [*completed_round_results, *new_results],
            )
            if round_results is None:
                error = RuntimeError("Tool results do not match the pending request batch")
                await self._emit(
                    "turn_failed",
                    iteration=checkpoint.iteration,
                    payload={"errorKind": "conversation_format_error", "message": str(error)},
                )
                return self._failed(
                    messages,
                    checkpoint.completed_model_iterations,
                    context_state,
                    snapshots,
                    tool_results,
                    error,
                    error_kind="conversation_format_error",
                )
            for result in round_results:
                await self._emit("tool_result_committed", iteration=checkpoint.iteration, payload=result.save())
            messages.extend(response.assistant_messages)
            messages.extend(self._tool_result_messages(round_results))
            await self._emit(
                "conversation_updated",
                iteration=checkpoint.iteration,
                payload={"toolResults": [result.save() for result in round_results]},
            )
            await self._checkpoint(
                iteration=checkpoint.iteration,
                messages=messages,
                stable_prefix_messages=checkpoint.stable_prefix_messages,
                inputs=checkpoint.inputs,
                context_state=context_state,
                completed_model_iterations=checkpoint.completed_model_iterations,
                completed_tool_results=tool_results,
            )

        iteration = checkpoint.iteration if checkpoint.resume_same_iteration else checkpoint.completed_model_iterations
        return await self._drive(
            messages=messages,
            inputs=checkpoint.inputs,
            max_iterations=max_iterations,
            cancellation=cancellation,
            iteration=iteration,
            stable_prefix_messages=checkpoint.stable_prefix_messages,
            context_state=context_state,
            snapshots=snapshots,
            tool_results=tool_results,
        )

    def _start_run(
        self,
        session_id: str,
        turn_id: str,
        *,
        run_id: str | None,
        parent_run_id: str | None,
        delegation_depth: int,
    ) -> None:
        self._session_id = session_id
        self._turn_id = turn_id
        self._run_id = run_id or self._next_id("run")
        self._parent_run_id = parent_run_id
        self._delegation_depth = delegation_depth
        self._sequence = 0

    async def _drive(
        self,
        *,
        messages: list[Message],
        inputs: Any | None,
        max_iterations: int,
        cancellation: CancellationToken | None,
        iteration: int,
        stable_prefix_messages: int,
        context_state: InvocationContextState,
        snapshots: list[ModelInvocationContextSnapshot],
        tool_results: list[ModelToolResult],
    ) -> TurnEngineResult:
        while iteration < max_iterations:
            if cancellation is not None and cancellation.is_cancelled:
                await self._emit("turn_cancelled", iteration=iteration)
                return self._cancelled(messages, iteration, context_state, snapshots, tool_results)

            invocation_id = self._next_id("invocation")
            snapshot = ModelInvocationContextSnapshot(
                id=self._next_id("snapshot"),
                session_id=self._session_id,
                turn_id=self._turn_id,
                invocation_id=invocation_id,
                iteration=iteration,
                messages=list(messages),
                stable_prefix_messages=min(stable_prefix_messages, len(messages)),
                context_state=context_state,
            )
            snapshots.append(snapshot)
            await self._emit("context_prepared", invocation_id=invocation_id, iteration=iteration)
            await self._emit("model_invocation_started", invocation_id=invocation_id, iteration=iteration)
            try:
                response = await _resolve(self._invoke_model(ModelInvocationRequest(context=snapshot)))
            except Exception as exc:
                await self._emit(
                    "model_invocation_failed",
                    invocation_id=invocation_id,
                    iteration=iteration,
                    payload={"errorKind": "model_error", "message": str(exc)},
                )
                await self._emit(
                    "turn_failed",
                    iteration=iteration,
                    payload={"errorKind": "model_error", "message": str(exc)},
                )
                return self._failed(
                    messages,
                    iteration,
                    context_state,
                    snapshots,
                    tool_results,
                    exc,
                    error_kind="model_error",
                )
            if not isinstance(response, ModelInvocationResponse):
                raise TypeError("invoke_model must return ModelInvocationResponse")
            await self._emit("model_invocation_completed", invocation_id=invocation_id, iteration=iteration)

            completed_iterations = iteration + 1
            if response.next_context_state is not None:
                validation_error = self._validate_context_state(response.next_context_state)
                if validation_error is not None:
                    await self._emit(
                        "turn_failed",
                        invocation_id=invocation_id,
                        iteration=iteration,
                        payload={"errorKind": "provider_state_error", "message": validation_error},
                    )
                    return self._failed(
                        messages,
                        completed_iterations,
                        context_state,
                        snapshots,
                        tool_results,
                        RuntimeError(validation_error),
                        error_kind="provider_state_error",
                    )
                context_state = response.next_context_state
            if not response.tool_requests:
                messages.extend(response.assistant_messages)
            await self._checkpoint(
                iteration=iteration,
                messages=messages,
                stable_prefix_messages=stable_prefix_messages,
                inputs=inputs,
                context_state=context_state,
                completed_model_iterations=completed_iterations,
                pending_tool_requests=response.tool_requests,
                pending_model_response=response if response.tool_requests else None,
                pending_output=response.output,
                final_output_ready=not response.tool_requests,
                completed_tool_results=tool_results,
                active_invocation_id=invocation_id,
            )
            if cancellation is not None and cancellation.is_cancelled:
                await self._emit("turn_cancelled", invocation_id=invocation_id, iteration=iteration)
                return self._cancelled(messages, completed_iterations, context_state, snapshots, tool_results)

            if not response.tool_requests:
                return await self._commit(
                    status="success",
                    output=response.output,
                    messages=messages,
                    iterations=completed_iterations,
                    context_state=context_state,
                    snapshots=snapshots,
                    tool_results=tool_results,
                )

            try:
                round_results = await self._execute_pending_tools(
                    response.tool_requests,
                    tool_results,
                    iteration=iteration,
                    cancellation=cancellation,
                    messages=messages,
                    inputs=inputs,
                    context_state=context_state,
                    response=response,
                    stable_prefix_messages=stable_prefix_messages,
                    active_invocation_id=invocation_id,
                )
            except _TurnCancelled:
                await self._emit("turn_cancelled", invocation_id=invocation_id, iteration=iteration)
                return self._cancelled(messages, completed_iterations, context_state, snapshots, tool_results)
            tool_results.extend(round_results)
            if any(result.outcome == "indeterminate" for result in round_results):
                return await self._reconciliation_required(
                    messages=messages,
                    iterations=completed_iterations,
                    context_state=context_state,
                    snapshots=snapshots,
                    tool_results=tool_results,
                )
            ordered_results = self._ordered_round_results(response.tool_requests, round_results)
            if ordered_results is None:
                error = RuntimeError("Tool results do not match the pending request batch")
                await self._emit(
                    "turn_failed",
                    invocation_id=invocation_id,
                    iteration=iteration,
                    payload={"errorKind": "conversation_format_error", "message": str(error)},
                )
                return self._failed(
                    messages,
                    completed_iterations,
                    context_state,
                    snapshots,
                    tool_results,
                    error,
                    error_kind="conversation_format_error",
                )
            round_results = ordered_results
            for result in round_results:
                await self._emit("tool_result_committed", iteration=iteration, payload=result.save())
            messages.extend(response.assistant_messages)
            messages.extend(self._tool_result_messages(round_results))
            await self._emit(
                "conversation_updated",
                iteration=iteration,
                payload={"toolResults": [result.save() for result in round_results]},
            )
            await self._checkpoint(
                iteration=iteration,
                messages=messages,
                stable_prefix_messages=stable_prefix_messages,
                inputs=inputs,
                context_state=context_state,
                completed_model_iterations=completed_iterations,
                completed_tool_results=tool_results,
            )
            iteration = completed_iterations

        error = RuntimeError(f"Turn exceeded max_iterations ({max_iterations})")
        await self._emit(
            "turn_failed",
            iteration=iteration,
            payload={"errorKind": "max_iterations", "message": str(error)},
        )
        return self._failed(
            messages,
            iteration,
            context_state,
            snapshots,
            tool_results,
            error,
            error_kind="max_iterations",
        )

    async def _execute_pending_tools(
        self,
        requests: list[ModelToolRequest],
        completed: list[ModelToolResult],
        *,
        iteration: int,
        cancellation: CancellationToken | None,
        messages: list[Message],
        inputs: Any | None,
        context_state: InvocationContextState,
        response: ModelInvocationResponse,
        stable_prefix_messages: int,
        active_invocation_id: str | None,
    ) -> list[ModelToolResult]:
        completed_ids = {result.request_id for result in completed}
        results: list[ModelToolResult] = []
        for request in requests:
            if request.id in completed_ids:
                continue
            if cancellation is not None and cancellation.is_cancelled:
                raise _TurnCancelled

            await self._emit("permission_requested", iteration=iteration, payload=request.save())
            decision = await self._permission(request)
            await self._emit("permission_resolved", iteration=iteration, payload=decision.save())
            if not decision.approved:
                result = ModelToolResult(
                    request_id=request.id,
                    name=request.name,
                    outcome="failed",
                    output={"message": decision.reason or "Permission denied"},
                    error_kind="permission_denied",
                )
            else:
                await self._emit("tool_execution_started", iteration=iteration, payload=request.save())
                try:
                    result = await _resolve(self._execute_tool(request))
                except Exception as exc:
                    result = ModelToolResult(
                        request_id=request.id,
                        name=request.name,
                        outcome="failed",
                        output={"message": str(exc)},
                        error_kind="exception",
                    )
                if not isinstance(result, ModelToolResult):
                    raise TypeError("execute_tool must return ModelToolResult")
                await self._emit("tool_execution_completed", iteration=iteration, payload=result.save())
            results.append(result)
            await self._checkpoint(
                iteration=iteration,
                messages=messages,
                stable_prefix_messages=stable_prefix_messages,
                inputs=inputs,
                context_state=context_state,
                completed_model_iterations=iteration + 1,
                pending_tool_requests=requests,
                completed_tool_results=[*completed, *results],
                pending_model_response=response,
                active_invocation_id=active_invocation_id,
                reconciliation_required=any(
                    item.outcome == "indeterminate" for item in [*completed, *results]
                ),
            )
            if result.outcome == "indeterminate":
                return results
        return results

    async def _permission(self, request: ModelToolRequest) -> EnginePermissionDecision:
        if self._authorize is None:
            return EnginePermissionDecision(approved=True, reason="allow_all")
        decision = await _resolve(self._authorize(request))
        if isinstance(decision, bool):
            return EnginePermissionDecision(approved=decision)
        if not isinstance(decision, EnginePermissionDecision):
            raise TypeError("authorize must return bool or EnginePermissionDecision")
        return decision

    async def _checkpoint(
        self,
        *,
        iteration: int,
        messages: list[Message],
        stable_prefix_messages: int,
        inputs: Any | None,
        context_state: InvocationContextState,
        completed_model_iterations: int,
        pending_tool_requests: list[ModelToolRequest] | None = None,
        completed_tool_results: list[ModelToolResult] | None = None,
        pending_output: Any | None = None,
        final_output_ready: bool = False,
        pending_model_response: ModelInvocationResponse | None = None,
        active_invocation_id: str | None = None,
        reconciliation_required: bool = False,
    ) -> EngineCheckpoint:
        checkpoint = EngineCheckpoint(
            id=self._next_id("checkpoint"),
            session_id=self._session_id,
            turn_id=self._turn_id,
            run_id=self._run_id,
            parent_run_id=self._parent_run_id,
            delegation_depth=self._delegation_depth,
            iteration=iteration,
            last_sequence=self._sequence,
            messages=list(messages),
            stable_prefix_messages=stable_prefix_messages,
            inputs=inputs,
            pending_tool_requests=list(pending_tool_requests or []),
            completed_tool_results=list(completed_tool_results or []),
            completed_model_iterations=completed_model_iterations,
            reconciliation_required=reconciliation_required,
            pending_output=pending_output,
            final_output_ready=final_output_ready,
            pending_model_response=pending_model_response,
            active_invocation_id=active_invocation_id,
            context_state=context_state,
        )
        if self._save_checkpoint is not None:
            await _resolve(self._save_checkpoint(checkpoint))
        await self._emit(
            "checkpoint_created",
            invocation_id=active_invocation_id,
            iteration=iteration,
            payload={"checkpointId": checkpoint.id, "includedThroughSequence": checkpoint.last_sequence},
        )
        return checkpoint

    async def _commit(
        self,
        *,
        status: str,
        output: Any | None,
        messages: list[Message],
        iterations: int,
        context_state: InvocationContextState,
        snapshots: list[ModelInvocationContextSnapshot],
        tool_results: list[ModelToolResult],
        model_reconciliation: ModelReconciliationState | None = None,
    ) -> TurnEngineResult:
        event = await self._emit("turn_committed", iteration=iterations, payload={"status": status})
        commit = TurnCommit(
            session_id=self._session_id,
            turn_id=self._turn_id,
            status=status,
            output=output,
            messages=list(messages),
            iterations=iterations,
            last_sequence=event.sequence,
            context_state=context_state,
        )
        post_commit_error: str | None = None
        await self._emit("post_commit_started", iteration=iterations)
        try:
            if self._post_commit is not None:
                await _resolve(self._post_commit(commit))
        except Exception as exc:
            post_commit_error = str(exc)
            await self._emit("post_commit_failed", iteration=iterations, payload={"message": post_commit_error})
        else:
            await self._emit("post_commit_completed", iteration=iterations)
        commit.last_sequence = self._sequence
        return TurnEngineResult(
            commit=commit,
            snapshots=snapshots,
            tool_results=tool_results,
            post_commit_error=post_commit_error,
        )

    async def _reconciliation_required(
        self,
        *,
        messages: list[Message],
        iterations: int,
        context_state: InvocationContextState,
        snapshots: list[ModelInvocationContextSnapshot],
        tool_results: list[ModelToolResult],
        model_reconciliation: ModelReconciliationState | None = None,
    ) -> TurnEngineResult:
        event = await self._emit(
            "turn_reconciliation_required",
            iteration=iterations,
            payload={"errorKind": "effect_outcome_unknown"},
        )
        return TurnEngineResult(
            commit=TurnCommit(
                session_id=self._session_id,
                turn_id=self._turn_id,
                status="reconciliation_required",
                output={
                    "errorKind": "effect_outcome_unknown",
                    "message": "An external effect requires reconciliation before the turn can continue",
                },
                messages=list(messages),
                iterations=iterations,
                last_sequence=event.sequence,
                context_state=context_state,
                model_reconciliation=model_reconciliation,
            ),
            snapshots=snapshots,
            tool_results=tool_results,
        )

    def _cancelled(
        self,
        messages: list[Message],
        iterations: int,
        context_state: InvocationContextState,
        snapshots: list[ModelInvocationContextSnapshot],
        tool_results: list[ModelToolResult],
        model_reconciliation: ModelReconciliationState | None = None,
    ) -> TurnEngineResult:
        return TurnEngineResult(
            commit=TurnCommit(
                session_id=self._session_id,
                turn_id=self._turn_id,
                status="cancelled",
                messages=list(messages),
                iterations=iterations,
                last_sequence=self._sequence,
                context_state=context_state,
                model_reconciliation=model_reconciliation,
            ),
            snapshots=snapshots,
            tool_results=tool_results,
        )

    def _failed(
        self,
        messages: list[Message],
        iterations: int,
        context_state: InvocationContextState,
        snapshots: list[ModelInvocationContextSnapshot],
        tool_results: list[ModelToolResult],
        error: Exception,
        *,
        error_kind: str = "engine_error",
    ) -> TurnEngineResult:
        return TurnEngineResult(
            commit=TurnCommit(
                session_id=self._session_id,
                turn_id=self._turn_id,
                status="failed",
                output={"errorKind": error_kind, "message": str(error)},
                messages=list(messages),
                iterations=iterations,
                last_sequence=self._sequence,
                context_state=context_state,
            ),
            snapshots=snapshots,
            tool_results=tool_results,
        )

    async def _emit(
        self,
        kind: Any,
        *,
        invocation_id: str | None = None,
        iteration: int | None = None,
        payload: Any | None = None,
    ) -> EngineEvent:
        self._sequence += 1
        event = EngineEvent(
            sequence=self._sequence,
            id=self._next_id("event"),
            timestamp=self._now(),
            session_id=self._session_id,
            turn_id=self._turn_id,
            run_id=self._run_id,
            parent_run_id=self._parent_run_id,
            delegation_depth=self._delegation_depth,
            invocation_id=invocation_id,
            iteration=iteration,
            kind=kind,
            payload=payload,
        )
        if self._on_event is not None:
            await _resolve(self._on_event(event))
        return event

    @staticmethod
    def _tool_result_messages(results: list[ModelToolResult]) -> list[Message]:
        messages: list[Message] = []
        for result in results:
            value = result.output if isinstance(result.output, str) else json.dumps(result.output)
            if result.output is None:
                value = ""
            messages.append(
                Message(
                    role="tool",
                    parts=[TextPart(value=value)],
                    metadata={
                        "tool_call_id": result.request_id,
                    },
                )
            )
        return messages

    @staticmethod
    def _validate_context_state(state: InvocationContextState) -> str | None:
        if state.portability == "portable" and state.delegated_state:
            return "Portable context state cannot contain delegated provider references"
        if state.portability == "delegated" and not state.delegated_state:
            return "Delegated context state requires at least one provider reference"
        return None

    @staticmethod
    def _ordered_round_results(
        requests: list[ModelToolRequest],
        results: list[ModelToolResult],
    ) -> list[ModelToolResult] | None:
        by_id = {result.request_id: result for result in results}
        if len(by_id) != len(requests) or any(request.id not in by_id for request in requests):
            return None
        return [by_id[request.id] for request in requests]
