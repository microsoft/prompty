"""Azure OpenAI provider — executor and processor for Azure OpenAI API."""

from __future__ import annotations

from .executor import AzureExecutor
from .processor import AzureProcessor

__all__ = ["AzureExecutor", "AzureProcessor"]
