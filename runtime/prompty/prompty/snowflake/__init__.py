"""Snowflake Cortex integration for Prompty"""
from prompty.invoker import InvokerException

try:
    from .executor import SnowflakeCortexExecutor # noqa
    from .processor import SnowflakeCortexProcessor # noqa
except ImportError as e:
    raise InvokerException(
        f"Error registering SnowflakeCortexExecutor and SnowflakeCortexProcessor: {e}", "snowflakecortex"
    )