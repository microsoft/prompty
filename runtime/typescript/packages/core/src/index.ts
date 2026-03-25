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
// Implementations (core-provided: renderers + parsers only)
// ---------------------------------------------------------------------------

export { NunjucksRenderer, MustacheRenderer } from "./renderers/index.js";
export { PromptyChatParser } from "./parsers/index.js";

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
  FoundryConnection,
  LoadContext,
  SaveContext,
  Tool,
  FunctionTool,
} from "agentschema";

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
