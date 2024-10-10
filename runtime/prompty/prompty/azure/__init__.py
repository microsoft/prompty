# __init__.py
from prompty.core import InvokerException

try:
    from .executor import AzureOpenAIExecutor
    from .processor import AzureOpenAIProcessor
except ImportError:
    raise InvokerException(
        "Error registering AzureOpenAIExecutor and AzureOpenAIProcessor", "azure"
    )
