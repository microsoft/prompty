# __init__.py
from prompty.invoker import InvokerException

try:
    # Reuse the common Azure OpenAI Processor
    from ..azure.processor import AzureOpenAIProcessor # noqa
    from .executor import AzureOpenAIBetaExecutor # noqa
except ImportError:
    raise InvokerException(
        "Error registering AzureOpenAIBetaExecutor and AzureOpenAIProcessor", "azure_beta"
    )
