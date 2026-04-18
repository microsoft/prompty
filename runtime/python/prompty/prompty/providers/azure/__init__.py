"""Backward-compatibility aliases — use ``prompty.providers.foundry`` instead."""

from __future__ import annotations

from ..foundry.executor import FoundryExecutor as AzureExecutor
from ..foundry.models import list_models, list_models_async
from ..foundry.processor import FoundryProcessor as AzureProcessor

__all__ = ["AzureExecutor", "AzureProcessor", "list_models", "list_models_async"]
