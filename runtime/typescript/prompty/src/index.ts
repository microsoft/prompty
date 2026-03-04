/**
 * Prompty — load, render, parse, and execute .prompty files.
 *
 * ```
 * execute(prompt, inputs)              → top-level orchestrator
 *   ├── prepare(agent, inputs)         → template → wire format
 *   │     ├── render(agent, inputs)    → template + inputs → rendered string
 *   │     └── parse(agent, rendered)   → rendered string → Message[]
 *   └── run(agent, messages)           → LLM call → clean result
 *         ├── Executor.execute(...)    → messages → raw LLM response
 *         └── process(agent, response) → raw response → clean result
 * ```
 *
 * @module prompty
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

  // Pipeline functions
  validateInputs,
  render,
  parse,
  process,
  prepare,
  run,
  execute,
  executeAgent,
  runAgent,
} from "./core/index.js";

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

export { NunjucksRenderer, MustacheRenderer } from "./renderers/index.js";
export { PromptyChatParser } from "./parsers/index.js";
export { OpenAIExecutor } from "./providers/openai/index.js";
export { OpenAIProcessor } from "./providers/openai/index.js";
export { AzureExecutor } from "./providers/azure/index.js";
export { AzureProcessor } from "./providers/azure/index.js";

// Wire format utilities
export { messageToWire, buildChatArgs } from "./providers/openai/wire.js";

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

export {
  Tracer,
  trace,
  traceSpan,
  sanitizeValue,
  toSerializable,
  consoleTracer,
  type TracerBackend,
  type TracerFactory,
  type SpanEmitter,
} from "./tracing/index.js";

// ---------------------------------------------------------------------------
// Re-export key agentschema types for convenience
// ---------------------------------------------------------------------------

export {
  AgentDefinition,
  PromptAgent,
  Model,
  ModelOptions,
  Template,
  Format,
  Parser as AgentSchemaParser,
  Property,
  PropertySchema,
  Connection,
  ApiKeyConnection,
  ReferenceConnection,
  AnonymousConnection,
  LoadContext,
  SaveContext,
  Tool,
  FunctionTool,
} from "agentschema";

// ---------------------------------------------------------------------------
// Auto-register built-in implementations
// ---------------------------------------------------------------------------

import { registerRenderer, registerParser, registerExecutor, registerProcessor } from "./core/registry.js";
import { NunjucksRenderer } from "./renderers/nunjucks.js";
import { MustacheRenderer } from "./renderers/mustache.js";
import { PromptyChatParser } from "./parsers/prompty.js";
import { OpenAIExecutor } from "./providers/openai/executor.js";
import { OpenAIProcessor } from "./providers/openai/processor.js";
import { AzureExecutor } from "./providers/azure/executor.js";
import { AzureProcessor } from "./providers/azure/processor.js";

// Renderers
registerRenderer("nunjucks", new NunjucksRenderer());
registerRenderer("jinja2", new NunjucksRenderer()); // jinja2 alias → nunjucks
registerRenderer("mustache", new MustacheRenderer());

// Parsers
registerParser("prompty", new PromptyChatParser());

// Executors
registerExecutor("openai", new OpenAIExecutor());
registerExecutor("azure", new AzureExecutor());

// Processors
registerProcessor("openai", new OpenAIProcessor());
registerProcessor("azure", new AzureProcessor());
