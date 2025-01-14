# __init__.py
from prompty.invoker import InvokerException

try:
    # Reuse the common Azure OpenAI Processor
    from ..azure.processor import AzureOpenAIProcessor
    from .executor import AzureOpenAIBetaExecutor
except ImportError:
    raise InvokerException(
        "Error registering AzureOpenAIBetaExecutor and AzureOpenAIProcessor", "azure_beta"
    )
