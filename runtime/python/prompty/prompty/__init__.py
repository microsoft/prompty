from __future__ import annotations

from ._version import VERSION

__version__ = VERSION

# Re-export generated model types
# Connection registry
from .core.connections import clear_connections, get_connection, register_connection

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
    execute_agent,
    execute_agent_async,
    execute_async,
    headless,
    parse,
    parse_async,
    prepare,
    prepare_async,
    process,
    process_async,
    render,
    render_async,
    run,
    run_agent,
    run_agent_async,
    run_async,
    validate_inputs,
)
from .model import (
    AnonymousConnection,
    ApiKeyConnection,
    ArrayProperty,
    Binding,
    Connection,
    CustomTool,
    FormatConfig,
    FoundryConnection,
    FunctionTool,
    LoadContext,
    McpApprovalMode,
    McpTool,
    Model,
    ModelOptions,
    OAuthConnection,
    ObjectProperty,
    OpenApiTool,
    ParserConfig,
    Prompty,
    PromptyTool,
    Property,
    ReferenceConnection,
    RemoteConnection,
    SaveContext,
    Template,
    Tool,
)

# Concrete invokers
from .parsers import PromptyChatParser

# Provider implementations
from .providers.anthropic.executor import AnthropicExecutor
from .providers.anthropic.processor import AnthropicProcessor
from .providers.foundry.executor import FoundryExecutor
from .providers.foundry.processor import FoundryProcessor
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

# Backward-compat aliases (will be removed in a future version)
AzureExecutor = FoundryExecutor
AzureProcessor = FoundryProcessor
PromptAgent = Prompty
AgentDefinition = Prompty
