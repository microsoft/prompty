# __init__.py
from prompty.invoker import InvokerException

try:
    from .executor import AzureOpenAIBetaExecutor
    # Reuse the common Azure OpenAI Processor
    from ..azure.processor import AzureOpenAIProcessor
except ImportError:
    raise InvokerException(
        "Error registering AzureOpenAIBetaExecutor and AzureOpenAIProcessor", "azure_beta"
    )
