"""Microsoft Foundry provider — executor and processor for Azure OpenAI API."""

from __future__ import annotations

from .executor import FoundryExecutor
from .processor import FoundryProcessor

__all__ = ["FoundryExecutor", "FoundryProcessor"]
