"""Azure OpenAI provider — executor and processor for Azure OpenAI API."""

from .executor import AzureExecutor
from .processor import AzureProcessor

__all__ = ["AzureExecutor", "AzureProcessor"]
