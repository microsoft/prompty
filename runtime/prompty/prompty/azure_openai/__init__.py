# __init__.py
from prompty.core import InvokerException

try:
    from ..azure.executor import AzureOpenAIExecutor
    from ..azure.processor import AzureOpenAIProcessor
except ImportError:
    raise InvokerException(
        "Error registering AzureOpenAIExecutor and AzureOpenAIProcessor", "azure"
    )
