"""Backward-compatibility alias — use ``prompty.providers.foundry.executor`` instead."""

from __future__ import annotations

from ..foundry.executor import FoundryExecutor as AzureExecutor

__all__ = ["AzureExecutor"]
