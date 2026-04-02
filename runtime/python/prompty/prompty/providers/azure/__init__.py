"""Backward-compatibility aliases — use ``prompty.providers.foundry`` instead."""

from __future__ import annotations

from ..foundry.executor import FoundryExecutor as AzureExecutor
from ..foundry.processor import FoundryProcessor as AzureProcessor

__all__ = ["AzureExecutor", "AzureProcessor"]
