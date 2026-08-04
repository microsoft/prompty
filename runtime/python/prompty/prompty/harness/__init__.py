"""Provide reference harness adapters for event, trace, permission, and tool protocols."""

from .adapters import (
    AllowAllPermissionResolver,
    CollectingEventSink,
    DenyAllPermissionResolver,
    FunctionHostToolExecutor,
    InMemoryCheckpointStore,
    JsonlEventJournalWriter,
)
from .engine import ReferenceTurnEngine, load_engine_checkpoint, save_engine_checkpoint
from .replay_verifier import ReferenceReplayVerifier
from .turn_runner import (
    ReferenceTurnRunner,
    RunTurnRequest,
    RunTurnResult,
    TurnModelRequest,
    TurnModelResponse,
)

__all__ = [
    "AllowAllPermissionResolver",
    "CollectingEventSink",
    "DenyAllPermissionResolver",
    "FunctionHostToolExecutor",
    "InMemoryCheckpointStore",
    "JsonlEventJournalWriter",
    "ReferenceReplayVerifier",
    "ReferenceTurnEngine",
    "ReferenceTurnRunner",
    "RunTurnRequest",
    "RunTurnResult",
    "TurnModelRequest",
    "TurnModelResponse",
    "load_engine_checkpoint",
    "save_engine_checkpoint",
]
