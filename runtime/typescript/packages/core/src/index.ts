/**
 * @prompty/core — load, render, parse, and trace .prompty files.
 *
 * This is the core package. It provides the loader, pipeline, types,
 * registry, renderers, parsers, and tracing. Provider packages
 * (@prompty/openai, @prompty/foundry, etc.) register their
 * executor/processor implementations separately.
 *
 * @module @prompty/core
 */

// ---------------------------------------------------------------------------
// Core types & interfaces
// ---------------------------------------------------------------------------

export {
  // Types
  type ContentPart,
  type TextPart,
  type ImagePart,
  type FilePart,
  type AudioPart,
  type Role,
  type ToolCall,
  Message,
  ThreadMarker,
  PromptyStream,
  RICH_KINDS,
  ROLES,
  text,
  textMessage,
  dictToMessage,
  dictContentToPart,

  // Interfaces
  type Renderer,
  type Parser,
  type Executor,
  type Processor,

  // Registry
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
  getRenderer,
  getParser,
  getExecutor,
  getProcessor,
  clearCache,
  InvokerError,

  // Connections
  registerConnection,
  getConnection,
  clearConnections,

  // Loader
  load,
  type LoadOptions,

  // Pipeline functions
  validateInputs,
  render,
  parse,
  process,
  prepare,
  run,
  turn,
  invoke,
  resolveBindings,
  StreamFailureError,
  type TurnOptions,
  type InvokeOptions,

  // Agent loop extensions (§13)
  type AgentEventType,
  type EventCallback,
  emitEvent,
  CancelledError,
  checkCancellation,
  estimateChars,
  summarizeDropped,
  trimToContextWindow,
  formatDroppedMessages,
  type GuardrailResult,
  GuardrailError,
  type InputGuardrail,
  type OutputGuardrail,
  type ToolGuardrail,
  type GuardrailsOptions,
  Guardrails,
  Steering,

  // Tool decorator (§11.2)
  tool,
  bindTools,
  type ToolOptions,
  type ToolParameter,
  type ToolFunction,

  // Structured result casting (§8.8)
  type StructuredResult,
  StructuredResultSymbol,
  createStructuredResult,
  isStructuredResult,
  cast,

  // Provider-agnostic conformance engines
  runAgentLoop,
  totalMessages,
  type AgentLoopResult,
  type AgentToolCall,
  type ModelResponse,
  type GuardrailDecision as AgentGuardrailDecision,
  type SteeringMessage as AgentSteeringMessage,
  SUMMARY_PREFIX,
  runTurnEngine,
  type TurnResult,
  type TurnToolCall,
  type TurnModelTurn,
  type TurnToolResult,
  PORTABILITY_PORTABLE,
  PORTABILITY_DELEGATED,
  reconcileStream,
  type StreamReconciliation,
} from "./core/index.js";

// ---------------------------------------------------------------------------
// Implementations (core-provided: renderers + parsers only)
// ---------------------------------------------------------------------------

export { NunjucksRenderer, MustacheRenderer } from "./renderers/index.js";
export { PromptyChatParser } from "./parsers/index.js";
export {
  StrictViolationError,
  renderSegments,
  render as renderJinjaSubset,
  type Segment,
} from "./jinja-subset/index.js";

// ---------------------------------------------------------------------------
// Harness reference adapters
// ---------------------------------------------------------------------------

export {
  AllowAllPermissionResolver,
  CollectingEventSink,
  DenyAllPermissionResolver,
  FunctionHostToolExecutor,
  InMemoryCheckpointStore,
  JsonlEventJournalWriter,
  ReferenceReplayVerifier,
  ReferenceTurnRunner,
  ReplayVerificationRequest,
  ReplayVerificationResult,
  RunTurnRequest,
  RunTurnResult,
  type TurnModelCallback,
  TurnModelRequest,
  TurnModelResponse,
  type TurnRunnerDependencies,
} from "./harness/index.js";

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

export {
  Tracer,
  trace,
  traceMethod,
  traceSpan,
  sanitizeValue,
  toSerializable,
  consoleTracer,
  PromptyTracer,
  otelTracer,
  PKG_VERSION,
  type TracerBackend,
  type TracerFactory,
  type SpanEmitter,
  type OtelTracerOptions,
  type OtelApi,
} from "./tracing/index.js";

// ---------------------------------------------------------------------------
// Re-export generated model types
// ---------------------------------------------------------------------------

export {
  Agent,
  Model,
  ModelOptions,
  ModelInfo,
  Template,
  FormatConfig,
  ParserConfig,
  Property,
  ArrayProperty,
  ObjectProperty,
  Connection,
  ApiKeyConnection,
  ReferenceConnection,
  RemoteConnection,
  AnonymousConnection,
  FoundryConnection,
  OAuthConnection,
  LoadContext,
  SaveContext,
  Tool,
  FunctionTool,
  CustomTool,
  McpTool,
  OpenApiTool,
  McpApprovalMode,
  Binding,
  TurnEvent,
  SessionEvent,
  SessionSummary,
  Checkpoint,
  PermissionRequest,
  PermissionDecision,
  HostToolRequest,
  HostToolResult,
  StreamChunk,
  ErrorChunk,
  TextChunk,
  FailureChunk,
  StreamFailure,
  type EventJournalWriter,
  type EventSink,
  type PermissionResolver,
  type CheckpointStore,
  type HostToolExecutor,
} from "./model/index.js";

// Backward-compat aliases (will be removed in a future version)
export { Agent as PromptAgent } from "./model/index.js";
export { Agent as AgentDefinition } from "./model/index.js";

// ---------------------------------------------------------------------------
// Auto-register built-in renderers and parsers
// ---------------------------------------------------------------------------

import { registerRenderer, registerParser } from "./core/registry.js";
import { NunjucksRenderer } from "./renderers/nunjucks.js";
import { MustacheRenderer } from "./renderers/mustache.js";
import { PromptyChatParser } from "./parsers/prompty.js";

// Renderers
registerRenderer("nunjucks", new NunjucksRenderer());
registerRenderer("jinja2", new NunjucksRenderer()); // jinja2 alias → nunjucks
registerRenderer("mustache", new MustacheRenderer());

// Parsers
registerParser("prompty", new PromptyChatParser());
