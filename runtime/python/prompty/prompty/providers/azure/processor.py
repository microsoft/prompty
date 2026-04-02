"""Backward-compatibility alias — use ``prompty.providers.foundry.processor`` instead."""

from __future__ import annotations

from ..foundry.processor import FoundryProcessor as AzureProcessor

__all__ = ["AzureProcessor"]
