from ._version import VERSION

__version__ = VERSION

# Core API
# Re-export key agentschema types for convenience
from agentschema import (
    AgentDefinition,
    AnonymousConnection,
    ApiKeyConnection,
    Connection,
    CustomTool,
    Format,
    FunctionTool,
    LoadContext,
    McpTool,
    Model,
    ModelOptions,
    OpenApiTool,
    Parser,
    PromptAgent,
    Property,
    PropertySchema,
    ReferenceConnection,
    RemoteConnection,
    SaveContext,
    Template,
    Tool,
)

# Loader
from .core.loader import load, load_async

# Abstract message types
from .core.types import (
    RICH_KINDS,
    ROLES,
    AsyncPromptyStream,
    AudioPart,
    ContentPart,
    FilePart,
    ImagePart,
    Message,
    PromptyStream,
    TextPart,
    ThreadMarker,
)

# Pipeline (via backward-compat shim)
from .invoker import (
    ExecutorProtocol,
    InvokerError,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
    execute,
    execute_async,
    headless,
    prepare,
    prepare_async,
    process,
    process_async,
    run,
    run_async,
    validate_inputs,
)

# Concrete invokers
from .parsers import PromptyChatParser

# Provider implementations
from .providers.azure.executor import AzureExecutor
from .providers.azure.processor import AzureProcessor
from .providers.openai.executor import OpenAIExecutor
from .providers.openai.processor import OpenAIProcessor, ToolCall
from .renderers import Jinja2Renderer, MustacheRenderer

# Tracing
from .tracing.tracer import (
    PromptyTracer,
    Tracer,
    console_tracer,
    sanitize,
    to_dict,
    trace,
    trace_span,
    verbose_trace,
)
