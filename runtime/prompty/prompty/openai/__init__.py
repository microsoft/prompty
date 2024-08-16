# __init__.py
from prompty.core import InvokerException

try:
    from .executor import OpenAIExecutor
    from .processor import OpenAIProcessor
except ImportError:
    raise InvokerException(
        "Error registering OpenAIExecutor and OpenAIProcessor", "openai"
    )
