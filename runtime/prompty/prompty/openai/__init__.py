# __init__.py
from prompty.invoker import InvokerException

try:
    from .executor import OpenAIExecutor
    from .processor import OpenAIProcessor
except ImportError as e:
    raise InvokerException(
        f"Error registering OpenAIExecutor and OpenAIProcessor: {e}", "openai"
    )
