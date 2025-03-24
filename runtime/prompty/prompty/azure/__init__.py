# __init__.py
from prompty.invoker import InvokerException

try:
    from .executor import AzureOpenAIExecutor  # noqa
    from .processor import AzureOpenAIProcessor  # noqa
except ImportError:
    raise InvokerException("Error registering AzureOpenAIExecutor and AzureOpenAIProcessor", "azure")
