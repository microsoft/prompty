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

from .executor import AzureExecutor, OpenAIExecutor

# Pipeline
from .invoker import (
    ExecutorProtocol,
    InvokerError,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
    execute,
    execute_async,
    prepare,
    prepare_async,
    process,
    process_async,
    run,
    run_async,
    validate_inputs,
)
from .loader import load, load_async
from .parsers import PromptyChatParser
from .processor import AzureProcessor, OpenAIProcessor, ToolCall

# Concrete invokers
from .renderers import Jinja2Renderer, MustacheRenderer

# Tracing
from .tracer import (
    PromptyTracer,
    Tracer,
    console_tracer,
    sanitize,
    to_dict,
    trace,
    trace_span,
    verbose_trace,
)

# Abstract message types
from .types import (
    RICH_KINDS,
    ROLES,
    AudioPart,
    ContentPart,
    FilePart,
    ImagePart,
    Message,
    TextPart,
    ThreadMarker,
)
