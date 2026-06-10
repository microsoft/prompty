"""Provide reference harness adapters for event, trace, permission, and tool protocols."""

from .adapters import (
    AllowAllPermissionResolver,
    CollectingEventSink,
    DenyAllPermissionResolver,
    FunctionHostToolExecutor,
    InMemoryCheckpointStore,
    JsonlTraceWriter,
)

__all__ = [
    "AllowAllPermissionResolver",
    "CollectingEventSink",
    "DenyAllPermissionResolver",
    "FunctionHostToolExecutor",
    "InMemoryCheckpointStore",
    "JsonlTraceWriter",
]
