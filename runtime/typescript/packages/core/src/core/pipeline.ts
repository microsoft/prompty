/**
 * Execution pipeline — two top-level APIs plus building blocks.
 *
 * ```
 * invoke(prompt, inputs)               → one-shot: load + prepare + execute + process
 *   ├── load(path)                     → file → agent (when path given)
 *   ├── prepare(agent, inputs)         → template → wire format
 *   │     ├── render(agent, inputs)    → template + inputs → rendered string
 *   │     └── parse(agent, rendered)   → rendered string → Message[]
 *   ├── Executor.execute(...)          → messages → raw LLM response
 *   └── Processor.process(...)         → raw response → clean result
 *
 * turn(agent, inputs, options?)        → conversational round-trip
 *   ├── prepare(agent, inputs)         → template → wire format
 *   ├── Executor.execute(...)          → LLM call
 *   ├── [toolCalls → Executor]*        → agent loop (when tools provided)
 *   └── Processor.process(...)         → final result extraction
 *
 * run(agent, messages, options?)       → standalone: execute + process
 *   ├── Executor.execute(...)          → messages → raw LLM response
 *   └── Processor.process(...)         → raw response → clean result
 * ```
 *
 * `invoke` = "call this prompty like a function" (one-shot, embeddings, tool JSON).
 * `turn`   = "one round of a conversation" (thread history, turn numbering, tool loops).
 * `run`    = standalone building block for advanced users.
 *
 * Each step is independently traced. Users can bring their own
 * Renderer, Parser, Executor, Processor via the registry.
 *
 * @module
 */

import { Prompty } from "../model/prompty.js";
import {
  type ToolCall,
  Message,
  RICH_KINDS,
  dictToMessage,
  text,
} from "./types.js";
import { getRenderer, getParser, getExecutor, getProcessor } from "./registry.js";
import { getLastNonces, clearLastNonces } from "../renderers/common.js";
import { traceSpan, sanitizeValue } from "../tracing/tracer.js";
import { load } from "./loader.js";
import { dispatchTool, resilientJsonParse } from "./tool-dispatch.js";
import { type EventCallback, emitEvent } from "./agent-events.js";
import { CancelledError, checkCancellation } from "./cancellation.js";
import { trimToContextWindow } from "./context.js";
import { GuardrailError, Guardrails } from "./guardrails.js";
import { Steering } from "./steering.js";
import { cast } from "./structured.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FORMAT = "nunjucks";
const DEFAULT_PARSER = "prompty";
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_LLM_RETRIES = 3;

// ---------------------------------------------------------------------------
// ExecuteError (§9.10)
// ---------------------------------------------------------------------------

/**
 * Error from agent loop that includes accumulated conversation state.
 * Allows callers to resume by passing messages back as thread input.
 */
export class ExecuteError extends Error {
  public readonly messages: Message[];

  constructor(message: string, messages: Message[]) {
    super(message);
    this.name = "ExecuteError";
    this.messages = messages;
  }
}

/** Replace raw nonce strings with readable `{{thread:name}}` in trace output. */
function sanitizeNonces(value: unknown): unknown {
  const nonces = getLastNonces();
  if (nonces.size === 0) return value;

  // Build nonce → display name map
  const replacements = new Map<string, string>();
  for (const [name, nonce] of nonces) {
    replacements.set(nonce, `[thread: ${name}]`);
  }

  if (typeof value === "string") {
    let result = value;
    for (const [nonce, display] of replacements) {
      result = result.replaceAll(nonce, display);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map(v => sanitizeNonces(v));
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeNonces(v);
    }
    return result;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate and fill defaults for agent inputs.
 */
export function validateInputs(
  agent: Prompty,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const props = agent.inputs;
  if (!props || props.length === 0) return { ...inputs };

  const result = { ...inputs };

  for (const prop of props) {
    const name = prop.name;
    if (!name) continue;

    if (result[name] === undefined) {
      if (prop.default !== undefined) {
        result[name] = prop.default;
      } else if (prop.required) {
        throw new Error(`Missing required input: "${name}"`);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Resolve config helpers
// ---------------------------------------------------------------------------

function resolveFormatKind(agent: Prompty): string {
  return agent.template?.format?.kind ?? DEFAULT_FORMAT;
}

function resolveParserKind(agent: Prompty): string {
  return agent.template?.parser?.kind ?? DEFAULT_PARSER;
}

function resolveProvider(agent: Prompty): string {
  return agent.model?.provider ?? DEFAULT_PROVIDER;
}

function isStrictMode(agent: Prompty): boolean {
  // Default to strict=true to prevent prompt injection via role markers.
  // When strict, preRender wraps real role markers with nonces so the parser
  // rejects any role marker injected through user inputs.
  return agent.template?.format?.strict !== false;
}

/** Serialize agent for trace output, matching Python's load result shape. */
function serializeAgent(agent: Prompty): Record<string, unknown> {
  const model = agent.model;
  return sanitizeValue("agent", {
    name: agent.name ?? "",
    description: agent.description ?? "",
    metadata: agent.metadata ?? {},
    model: {
      id: model?.id ?? "",
      api: (model as unknown as Record<string, unknown>)?.apiType ?? "chat",
      provider: model?.provider ?? "",
      connection: model?.connection ?? {},
    },
    inputs: agent.inputs?.map(p => ({
      name: p.name ?? "",
      kind: p.kind ?? "",
      description: p.description ?? "",
      required: p.required ?? false,
      default: p.default,
      example: p.example,
    })) ?? [],
    outputs: agent.outputs?.map(p => ({
      name: p.name ?? "",
      kind: p.kind ?? "",
      description: p.description ?? "",
    })) ?? [],
    tools: agent.tools?.map(t => ({
      name: t.name ?? "",
      kind: t.kind ?? "",
    })) ?? [],
    template: {
      format: agent.template?.format?.kind ?? DEFAULT_FORMAT,
      parser: agent.template?.parser?.kind ?? DEFAULT_PARSER,
    },
    instructions: agent.instructions ?? "",
  }) as Record<string, unknown>;
}

/** Serialize messages for trace output, matching Python's parser result. */
function serializeMessages(messages: Message[]): unknown[] {
  return messages.map(m => ({
    role: m.role,
    content: m.text,
  }));
}

// ---------------------------------------------------------------------------
// Leaf steps
// ---------------------------------------------------------------------------

/**
 * Render the template with inputs.
 *
 * Discovered by: `agent.template.format.kind` (default: "nunjucks").
 */
export async function render(
  agent: Prompty,
  inputs: Record<string, unknown>,
): Promise<string> {
  const formatKind = resolveFormatKind(agent);
  const renderer = getRenderer(formatKind);

  return traceSpan(renderer.constructor?.name ?? "Renderer", async (emit) => {
    const template = agent.instructions ?? "";

    emit("signature", `prompty.renderers.${renderer.constructor?.name ?? "Renderer"}.render`);
    emit("inputs", { data: inputs });
    const result = await renderer.render(agent, template, inputs);
    emit("result", sanitizeNonces(result));
    return result;
  });
}

/**
 * Parse a rendered string into abstract messages.
 *
 * Discovered by: `agent.template.parser.kind` (default: "prompty").
 */
export async function parse(
  agent: Prompty,
  rendered: string,
  context?: Record<string, unknown>,
): Promise<Message[]> {
  const parserKind = resolveParserKind(agent);
  const parser = getParser(parserKind);

  return traceSpan(parser.constructor?.name ?? "Parser", async (emit) => {
    emit("signature", `prompty.parsers.${parser.constructor?.name ?? "Parser"}.parse`);
    emit("inputs", sanitizeNonces(rendered));
    const messages = await parser.parse(agent, rendered, context);
    emit("result", sanitizeNonces(serializeMessages(messages)));
    return messages;
  });
}

/**
 * Process a raw LLM response into a clean result.
 *
 * Discovered by: `agent.model.provider` (default: "openai").
 */
export async function process(
  agent: Prompty,
  response: unknown,
): Promise<unknown> {
  // Delegates directly — the processor implementation creates its own trace span
  const provider = resolveProvider(agent);
  const processor = getProcessor(provider);
  return processor.process(agent, response);
}

// ---------------------------------------------------------------------------
// Composite: prepare() = render + parse + thread expansion
// ---------------------------------------------------------------------------

/**
 * Render template + parse into messages + expand thread markers.
 */
export async function prepare(
  agent: Prompty,
  inputs?: Record<string, unknown>,
): Promise<Message[]> {
  return traceSpan("prepare", async (emit) => {
    emit("signature", "prompty.prepare");
    emit("description", "Render and parse into messages");

    const validatedInputs = validateInputs(agent, inputs ?? {});
    emit("inputs", validatedInputs);

    // Check for strict mode pre-render
    const parserKind = resolveParserKind(agent);
    const parser = getParser(parserKind);
    let context: Record<string, unknown> | undefined;

    if (isStrictMode(agent) && parser.preRender) {
      const [sanitized, ctx] = parser.preRender(agent.instructions ?? "");
      // Temporarily override instructions for rendering
      const originalInstructions = agent.instructions;
      agent.instructions = sanitized;
      context = ctx;

      // Render
      clearLastNonces();
      const rendered = await render(agent, validatedInputs);
      agent.instructions = originalInstructions;

      // Parse
      const messages = await parse(agent, rendered, context);

      // Thread expansion
      const nonces = getLastNonces();
      const expanded = expandThreads(messages, nonces, validatedInputs);

      emit("result", serializeMessages(expanded));
      return expanded;
    }

    // Non-strict path
    clearLastNonces();
    const rendered = await render(agent, validatedInputs);
    const messages = await parse(agent, rendered, context);

    // Thread expansion
    const nonces = getLastNonces();
    const expanded = expandThreads(messages, nonces, validatedInputs);

    emit("result", serializeMessages(expanded));
    return expanded;
  });
}

// ---------------------------------------------------------------------------
// Composite: run() = executor + process
// ---------------------------------------------------------------------------

/**
 * Execute messages against the LLM and process the response.
 */
export async function run(
  agent: Prompty,
  messages: Message[],
  options?: { raw?: boolean },
): Promise<unknown> {
  return traceSpan("run", async (emit) => {
    const provider = resolveProvider(agent);
    const executor = getExecutor(provider);

    emit("signature", "prompty.run");
    emit("description", "Execute LLM call and process response");
    emit("inputs", serializeMessages(messages));

    // executor.execute() creates its own trace span (e.g. "FoundryExecutor", "OpenAIExecutor")
    const response = await executor.execute(agent, messages);

    if (options?.raw) {
      emit("result", response);
      return response;
    }
    // process() delegates to the provider's processor which creates its own trace span
    const result = await process(agent, response);
    emit("result", result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Top-level: invoke() = load + prepare + execute + process (one-shot)
// ---------------------------------------------------------------------------

/** Options for {@link invoke}. */
export interface InvokeOptions {
  /** Return raw executor response without processing. */
  raw?: boolean;
}

/**
 * One-shot pipeline: load → prepare → execute → process.
 *
 * Use `invoke` to call a prompty like a function — give inputs, get output.
 * No conversation context or turn numbering. Supports file paths or
 * pre-loaded agents.
 *
 * Trace structure (flat):
 * ```
 * invoke
 *   load           (only when path given)
 *   prepare
 *     Renderer
 *     Parser
 *   Executor
 *   Processor
 * ```
 *
 * @overload Untyped — returns `unknown`.
 */
export async function invoke(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<unknown>;
/**
 * One-shot pipeline with typed result: load → prepare → execute → process → cast.
 *
 * When a `validator` is provided the raw result is deserialized from JSON
 * and passed through the validator (e.g. a Zod `.parse` function), giving
 * you a fully typed return value.
 *
 * @overload Typed — returns `Promise<T>`.
 */
export async function invoke<T>(
  prompt: string | Prompty,
  inputs: Record<string, unknown> | undefined,
  options: InvokeOptions & { validator: (data: unknown) => T },
): Promise<T>;
// Implementation
export async function invoke<T = unknown>(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: InvokeOptions & { validator?: (data: unknown) => T },
): Promise<T> {
  return traceSpan("invoke", async (emit) => {
    const agent = typeof prompt === "string"
      ? await traceSpan("load", async (loadEmit) => {
          loadEmit("signature", "prompty.load");
          loadEmit("description", "Load a prompty file.");
          loadEmit("inputs", { prompty_file: prompt });
          const loaded = load(prompt);
          loadEmit("result", serializeAgent(loaded));
          return loaded;
        })
      : prompt;

    emit("signature", "prompty.invoke");
    emit("description", "Invoke a prompty");
    emit("inputs", { prompt: serializeAgent(agent), inputs: inputs ?? {} });

    // Inline: prepare → executor → process (no run() wrapper)
    const messages = await prepare(agent, inputs);
    const provider = resolveProvider(agent);
    const executor = getExecutor(provider);
    const response = await executor.execute(agent, messages);

    if (options?.raw) {
      emit("result", response);
      if (options?.validator) {
        return cast<T>(response, options.validator);
      }
      return response as T;
    }
    const result = await process(agent, response);
    emit("result", result);
    if (options?.validator) {
      return cast<T>(result, options.validator);
    }
    return result as T;
  });
}

// ---------------------------------------------------------------------------
// LLM call retry (§9.10)
// ---------------------------------------------------------------------------

/**
 * Invoke executor.execute with exponential-backoff retry on transient failures.
 * Respects AbortSignal for cancellation during backoff.
 */
async function invokeWithRetry(
  executor: { execute(agent: Prompty, messages: Message[]): Promise<unknown> },
  agent: Prompty,
  messages: Message[],
  maxRetries: number,
  onEvent?: EventCallback,
  signal?: AbortSignal,
): Promise<unknown> {
  let attempts = 0;
  while (true) {
    try {
      return await executor.execute(agent, messages);
    } catch (err) {
      // Never retry cancellation
      if (err instanceof CancelledError) throw err;
      attempts++;
      if (attempts >= maxRetries) {
        throw new ExecuteError(
          `LLM call failed after ${maxRetries} retries: ${err instanceof Error ? err.message : String(err)}`,
          [...messages],
        );
      }
      // Emit status event
      emitEvent(onEvent, "status", {
        message: `LLM call failed, retrying (attempt ${attempts + 1}/${maxRetries})...`,
      });
      // Exponential backoff with jitter, capped at 60s (§9.10)
      // backoff = min(2^attempts + jitter(), 60) — values in seconds
      const backoffSecs = Math.min(Math.pow(2, attempts) + Math.random(), 60);
      // Check cancellation before sleeping
      if (signal?.aborted) {
        throw new CancelledError("Operation cancelled during retry backoff");
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, backoffSecs * 1000);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new CancelledError("Operation cancelled during retry backoff"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Turn: one conversational round-trip (§14)
// ---------------------------------------------------------------------------

/** Options for {@link turn}. */
export interface TurnOptions {
  /** Runtime tool handlers. When provided, triggers the agent loop. */
  tools?: Record<string, (...args: unknown[]) => unknown>;
  /** Turn number for trace labeling (e.g., "turn 3"). */
  turn?: number;
  /** Maximum agent-loop iterations before throwing (default: 10). */
  maxIterations?: number;
  /** Return raw executor response without processing. */
  raw?: boolean;
  /** Callback for agent loop events (token, tool_call, done, etc.). */
  onEvent?: EventCallback;
  /** Abort signal for cancellation (§13.2). */
  signal?: AbortSignal;
  /** Max character budget for context window trimming (§13.3). */
  contextBudget?: number;
  /** Input/output/tool guardrails (§13.4). */
  guardrails?: Guardrails;
  /** Steering queue for injecting messages mid-loop (§13.5). */
  steering?: Steering;
  /** Allow parallel tool execution within a single round (§13.6). */
  parallelToolCalls?: boolean;
  /** Maximum LLM call retries on transient failure in agent loop (§9.10, default: 3). */
  maxLlmRetries?: number;
}

/**
 * One conversational turn: prepare messages from inputs, then either execute a
 * single LLM call or enter the agent loop (when tools are provided).
 *
 * Trace structure (flat — no redundant wrappers):
 * ```
 * turn N
 *   prepare → Renderer → Parser
 *   Executor                        (each LLM call)
 *   toolCalls → tool1, tool2        (if tools provided)
 *   Executor                        (follow-up LLM call)
 *   Processor                       (final result extraction)
 * ```
 *
 * @overload Untyped — returns `unknown`.
 */
export async function turn(
  prompt: string | Prompty,
  inputs: Record<string, unknown>,
  options?: TurnOptions,
): Promise<unknown>;
/**
 * One conversational turn with typed result.
 *
 * When a `validator` is provided the final result is deserialized from JSON
 * and passed through the validator (e.g. a Zod `.parse` function).
 *
 * @overload Typed — returns `Promise<T>`.
 */
export async function turn<T>(
  prompt: string | Prompty,
  inputs: Record<string, unknown>,
  options: TurnOptions & { validator: (data: unknown) => T },
): Promise<T>;
// Implementation
export async function turn<T = unknown>(
  prompt: string | Prompty,
  inputs: Record<string, unknown>,
  options?: TurnOptions & { validator?: (data: unknown) => T },
): Promise<T> {
  const label = options?.turn != null ? `turn ${options.turn}` : "turn";
  const rawResult = await traceSpan(label, async (emit) => {
    const agent = typeof prompt === "string"
      ? await traceSpan("load", async (loadEmit) => {
          loadEmit("signature", "prompty.load");
          loadEmit("description", "Load a prompty file.");
          loadEmit("inputs", { prompty_file: prompt });
          const loaded = load(prompt);
          loadEmit("result", serializeAgent(loaded));
          return loaded;
        })
      : prompt;

    emit("signature", "prompty.turn");
    emit("description", label);
    emit("inputs", sanitizeValue("inputs", inputs));

    const tools = options?.tools ?? {};
    const hasTools = Object.keys(tools).length > 0;

    if (!hasTools) {
      // Simple mode: prepare → [extensions] → executor → [output guard] → process
      let messages = await prepare(agent, inputs);
      const onEvent = options?.onEvent;

      // §13.5 — Drain steering messages
      if (options?.steering) {
        const pending = options.steering.drain();
        if (pending.length > 0) {
          messages.push(...pending);
          emitEvent(onEvent, "messages_updated", { messages });
        }
      }

      // §13.3 — Trim context window
      if (options?.contextBudget !== undefined) {
        const [droppedCount] = trimToContextWindow(messages, options.contextBudget);
        if (droppedCount > 0) {
          emitEvent(onEvent, "messages_updated", { messages });
        }
      }

      // §13.4 — Input guardrail
      if (options?.guardrails) {
        const result = options.guardrails.checkInput(messages);
        if (!result.allowed) {
          emitEvent(onEvent, "error", { message: `Input guardrail denied: ${result.reason}` });
          throw new GuardrailError(result.reason ?? "Input guardrail denied");
        }
        if (result.rewrite) messages = result.rewrite;
      }

      // §13.2 — Check cancellation before LLM call
      checkCancellation(options?.signal);

      const provider = resolveProvider(agent);
      const executor = getExecutor(provider);
      const response = await executor.execute(agent, messages);

      if (options?.raw) {
        emit("result", response);
        return response;
      }
      const processed = await process(agent, response);

      // §13.4 — Output guardrail on final response
      if (options?.guardrails) {
        const contentStr = typeof processed === "string" ? processed : JSON.stringify(processed);
        const assistantMsg = new Message("assistant", [text(contentStr)]);
        const gr = options.guardrails.checkOutput(assistantMsg);
        if (!gr.allowed) {
          emitEvent(onEvent, "error", { message: `Output guardrail denied: ${gr.reason}` });
          throw new GuardrailError(gr.reason ?? "Output guardrail denied");
        }
        if (gr.rewrite !== undefined) {
          emit("result", gr.rewrite);
          emitEvent(onEvent, "done", { response: gr.rewrite, messages });
          return gr.rewrite;
        }
      }

      emit("result", sanitizeValue("result", processed));
      emitEvent(onEvent, "done", { response: processed, messages });
      return processed;
    }

    // Agent mode: prepare → [executor → toolCalls]* → executor → process
    const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxLlmRetries = options?.maxLlmRetries ?? DEFAULT_MAX_LLM_RETRIES;
    const onEvent = options?.onEvent;
    const signal = options?.signal;
    const contextBudget = options?.contextBudget;
    const guardrails = options?.guardrails;
    const steering = options?.steering;
    const parallelToolCalls = options?.parallelToolCalls ?? false;

    let messages = await prepare(agent, inputs);
    const parentInputs = inputs ?? {};
    const provider = resolveProvider(agent);
    const executor = getExecutor(provider);

    let response: unknown = null;
    let iteration = 0;

    while (true) {
      // §13.2 — Check cancellation at top of iteration
      try {
        checkCancellation(signal);
      } catch (err) {
        emitEvent(onEvent, "cancelled", {});
        throw err;
      }

      // §13.5 — Drain steering messages
      if (steering) {
        const pending = steering.drain();
        if (pending.length > 0) {
          messages.push(...pending);
          emitEvent(onEvent, "messages_updated", { messages });
          emitEvent(onEvent, "status", { message: `Injected ${pending.length} steering message(s)` });
        }
      }

      // §13.3 — Trim context window
      if (contextBudget !== undefined) {
        const [droppedCount] = trimToContextWindow(messages, contextBudget);
        if (droppedCount > 0) {
          emitEvent(onEvent, "messages_updated", { messages });
          emitEvent(onEvent, "status", { message: `Trimmed ${droppedCount} messages for context budget` });
        }
      }

      // §13.4 — Input guardrail
      if (guardrails) {
        const result = guardrails.checkInput(messages);
        if (!result.allowed) {
          emitEvent(onEvent, "error", { message: `Input guardrail denied: ${result.reason}` });
          throw new GuardrailError(result.reason ?? "Input guardrail denied");
        }
        if (result.rewrite) messages = result.rewrite;
      }

      // §13.2 — Check cancellation before LLM call
      try {
        checkCancellation(signal);
      } catch (err) {
        emitEvent(onEvent, "cancelled", {});
        throw err;
      }

      // Call LLM — §9.10: retry on transient failure
      response = await invokeWithRetry(executor, agent, messages, maxLlmRetries, onEvent, signal);

      // Streaming: consume the stream, extract tool calls from buffered chunks
      if (isAsyncIterable(response)) {
        const { toolCalls, content } = await consumeStream(agent, response, onEvent);

        // §13.4 — Output guardrail
        if (guardrails && content) {
          const assistantMsg = new Message("assistant", [text(content)]);
          const gr = guardrails.checkOutput(assistantMsg);
          if (!gr.allowed) {
            emitEvent(onEvent, "error", { message: `Output guardrail denied: ${gr.reason}` });
            throw new GuardrailError(gr.reason ?? "Output guardrail denied");
          }
        }

        if (toolCalls.length === 0) {
          emit("iterations", iteration);
          emit("result", content);
          emitEvent(onEvent, "done", { response: content, messages });
          return content;
        }

        iteration++;
        if (iteration > maxIterations) {
          throw new Error(
            `Agent loop exceeded maxIterations (${maxIterations}). ` +
            `The model kept requesting tool calls. Increase maxIterations or check your tools.`,
          );
        }

        const toolMessages = await traceSpan("toolCalls", async (toolEmit) => {
          toolEmit("signature", "prompty.turn.toolCalls");
          toolEmit("description", `Tool call round ${iteration}`);
          const result = await buildToolMessagesFromCallsWithExtensions(
            toolCalls, content, tools, agent, parentInputs, toolEmit,
            { onEvent, signal, guardrails, parallel: parallelToolCalls },
          );
          toolEmit("result", result.map((m) => ({ role: m.role, content: m.parts.map((p) => (p as { value?: string }).value ?? "").join(""), metadata: m.metadata })));
          return result;
        });

        messages.push(...toolMessages);
        emitEvent(onEvent, "messages_updated", { messages });
        continue;
      }

      // Non-streaming: check raw response for tool calls
      if (!hasToolCalls(response)) {
        const finalResult = options?.raw ? response : await process(agent, response);
        if (guardrails) {
          const contentStr = typeof finalResult === "string" ? finalResult : JSON.stringify(finalResult);
          const assistantMsg = new Message("assistant", [text(contentStr)]);
          const gr = guardrails.checkOutput(assistantMsg);
          if (!gr.allowed) {
            emitEvent(onEvent, "error", { message: `Output guardrail denied: ${gr.reason}` });
            throw new GuardrailError(gr.reason ?? "Output guardrail denied");
          }
          if (gr.rewrite !== undefined) {
            emit("iterations", iteration);
            emit("result", gr.rewrite);
            emitEvent(onEvent, "done", { response: gr.rewrite, messages });
            return gr.rewrite;
          }
        }
        emit("iterations", iteration);
        emit("result", finalResult);
        emitEvent(onEvent, "done", { response: finalResult, messages });
        return finalResult;
      }

      // §13.4 — Output guardrail (on tool-call response with text content)
      if (guardrails) {
        const { textContent } = extractToolInfo(response);
        if (textContent) {
          const assistantMsg = new Message("assistant", [text(textContent)]);
          const gr = guardrails.checkOutput(assistantMsg);
          if (!gr.allowed) {
            emitEvent(onEvent, "error", { message: `Output guardrail denied: ${gr.reason}` });
            throw new GuardrailError(gr.reason ?? "Output guardrail denied");
          }
        }
      }

      iteration++;
      if (iteration > maxIterations) {
        throw new Error(
          `Agent loop exceeded maxIterations (${maxIterations}). ` +
          `The model kept requesting tool calls. Increase maxIterations or check your tools.`,
        );
      }

      const toolMessages = await traceSpan("toolCalls", async (toolEmit) => {
        toolEmit("signature", "prompty.turn.toolCalls");
        toolEmit("description", `Tool call round ${iteration}`);
        const result = await buildToolResultMessagesWithExtensions(
          response, tools, agent, parentInputs, toolEmit,
          { onEvent, signal, guardrails, parallel: parallelToolCalls },
        );
        toolEmit("result", result.map((m) => ({ role: m.role, content: m.parts.map((p) => (p as { value?: string }).value ?? "").join(""), metadata: m.metadata })));
        return result;
      });

      messages.push(...toolMessages);
      emitEvent(onEvent, "messages_updated", { messages });
    }
  });
  if (options?.validator) {
    return cast<T>(rawResult, options.validator);
  }
  return rawResult as T;
}

// ---------------------------------------------------------------------------
// Binding resolution
// ---------------------------------------------------------------------------

/**
 * Resolve tool bindings: inject values from parentInputs into tool arguments.
 *
 * For each binding on the matched tool, looks up `binding.input` in parentInputs
 * and sets `args[binding.name]` to that value. Returns a new args object.
 */
export function resolveBindings(
  agent: Prompty,
  toolName: string,
  args: Record<string, unknown>,
  parentInputs?: Record<string, unknown>,
): Record<string, unknown> {
  if (!parentInputs || !agent.tools || agent.tools.length === 0) return args;

  const toolDef = agent.tools.find((t) => t.name === toolName);
  if (!toolDef || !toolDef.bindings || toolDef.bindings.length === 0) return args;

  const merged = { ...args };
  for (const binding of toolDef.bindings) {
    if (binding.input in parentInputs) {
      merged[binding.name] = parentInputs[binding.input];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Agent loop: turn()
// ---------------------------------------------------------------------------

/** Check if a value is an async iterable (i.e. a stream). */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}

/** Check if an item looks like a ToolCall from the processor. */
function isToolCallLike(item: unknown): item is ToolCall {
  return (
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    "name" in item &&
    "arguments" in item
  );
}

/**
 * Consume a streaming response through the processor.
 * Returns accumulated text content and any ToolCall objects.
 */
async function consumeStream(
  agent: Prompty,
  response: unknown,
  onEvent?: EventCallback,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  const processed = await process(agent, response);

  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  if (isAsyncIterable(processed)) {
    for await (const item of processed) {
      if (isToolCallLike(item)) {
        toolCalls.push(item);
      } else if (typeof item === "string") {
        textParts.push(item);
        emitEvent(onEvent, "token", { token: item });
      }
    }
  } else if (typeof processed === "string") {
    textParts.push(processed);
    emitEvent(onEvent, "token", { token: processed });
  }

  return { toolCalls, content: textParts.join("") };
}


// ---------------------------------------------------------------------------
// Thread marker helpers
// ---------------------------------------------------------------------------

/**
 * Get map of `{propertyName: kind}` for inputs with rich kinds.
 */
/**
 * Expand thread markers: replace nonce strings in message text
 * with actual conversation messages from inputs.
 */
function expandThreads(
  messages: Message[],
  nonces: Map<string, string>,
  inputs: Record<string, unknown>,
): Message[] {
  if (nonces.size === 0) return messages;

  // Build nonce → input name lookup
  const nonceToName = new Map<string, string>();
  for (const [name, nonce] of nonces) {
    nonceToName.set(nonce, name);
  }

  const result: Message[] = [];

  for (const msg of messages) {
    // Check if any text part contains a nonce
    let expanded = false;
    for (const part of msg.parts) {
      if (part.kind !== "text") continue;

      for (const [nonce, name] of nonceToName) {
        if (part.value.includes(nonce)) {
          // Split text around the nonce
          const before = part.value.slice(0, part.value.indexOf(nonce)).trim();
          const after = part.value.slice(part.value.indexOf(nonce) + nonce.length).trim();

          if (before) {
            result.push(new Message(msg.role, [text(before)], { ...msg.metadata }));
          }

          // Insert thread messages from input
          const threadMessages = inputs[name];
          if (Array.isArray(threadMessages)) {
            for (const tm of threadMessages) {
              if (tm instanceof Message) {
                result.push(tm);
              } else if (typeof tm === "object" && tm !== null) {
                result.push(dictToMessage(tm as Record<string, unknown>));
              }
            }
          }

          if (after) {
            result.push(new Message(msg.role, [text(after)], { ...msg.metadata }));
          }

          expanded = true;
          break;
        }
      }

      if (expanded) break;
    }

    if (!expanded) {
      result.push(msg);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool call helpers
// ---------------------------------------------------------------------------

function hasToolCalls(response: unknown): boolean {
  if (typeof response !== "object" || response === null) return false;
  const r = response as Record<string, unknown>;

  // OpenAI ChatCompletion shape: choices[0].message.tool_calls
  const choices = r.choices as unknown[] | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message) {
      const toolCalls = message.tool_calls as unknown[] | undefined;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) return true;
    }
  }

  // Anthropic Messages shape: content[].type === "tool_use"
  if (r.stop_reason === "tool_use" && Array.isArray(r.content)) {
    return (r.content as Record<string, unknown>[]).some(
      (block) => block.type === "tool_use",
    );
  }

  // OpenAI Responses API shape: output[].type === "function_call"
  if (r.object === "response" && Array.isArray(r.output)) {
    return (r.output as Record<string, unknown>[]).some(
      (item) => item.type === "function_call",
    );
  }

  return false;
}

/**
 * Extract normalized tool call info from any provider's raw response.
 * Returns a uniform array of `{id, name, arguments}` and any text content.
 */
function extractToolInfo(response: unknown): {
  toolCalls: { id: string; name: string; arguments: string; [key: string]: string }[];
  textContent: string;
} {
  if (typeof response !== "object" || response === null) {
    return { toolCalls: [], textContent: "" };
  }
  const r = response as Record<string, unknown>;

  // Anthropic: content[].type === "tool_use"
  if (Array.isArray(r.content) && r.stop_reason === "tool_use") {
    const content = r.content as Record<string, unknown>[];
    const toolCalls = content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id as string,
        name: b.name as string,
        arguments: JSON.stringify(b.input),
      }));
    const textContent = content
      .filter((b) => b.type === "text")
      .map((b) => b.text as string)
      .join("");
    return { toolCalls, textContent };
  }

  // OpenAI Responses API: output[].type === "function_call"
  if (r.object === "response" && Array.isArray(r.output)) {
    const funcCalls = (r.output as Record<string, unknown>[]).filter(
      (item) => item.type === "function_call",
    );
    const toolCalls = funcCalls.map((fc) => ({
      id: ((fc.call_id ?? fc.id ?? "") as string),
      call_id: ((fc.call_id ?? fc.id ?? "") as string),
      name: fc.name as string,
      arguments: (fc.arguments as string) ?? "{}",
    }));
    return { toolCalls, textContent: "" };
  }

  // OpenAI Chat: choices[0].message.tool_calls
  const choices = r.choices as unknown[] | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.tool_calls)) {
      const toolCalls = (message.tool_calls as Record<string, unknown>[]).map((tc) => {
        const fn = tc.function as Record<string, unknown>;
        return {
          id: tc.id as string,
          name: fn.name as string,
          arguments: fn.arguments as string,
        };
      });
      return { toolCalls, textContent: (message.content as string) ?? "" };
    }
  }

  return { toolCalls: [], textContent: "" };
}

// ---------------------------------------------------------------------------
// Extension-aware tool dispatch helpers (§13)
// ---------------------------------------------------------------------------

/** Options for extension-aware tool dispatch. */
interface ToolExtensionOptions {
  onEvent?: EventCallback;
  signal?: AbortSignal;
  guardrails?: Guardrails;
  parallel?: boolean;
}

/**
 * Dispatch a single tool call with §13 extensions (events, cancellation, guardrails).
 */
async function dispatchOneToolWithExtensions(
  tc: { id: string; name: string; arguments: string; [key: string]: string },
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs: Record<string, unknown>,
  ext: ToolExtensionOptions,
): Promise<string> {
  const { onEvent, signal, guardrails } = ext;

  // §13.2 — Check cancellation before each tool
  try {
    checkCancellation(signal);
  } catch (err) {
    emitEvent(onEvent, "cancelled", {});
    throw err;
  }

  // §13.1 — Emit tool_call_start
  emitEvent(onEvent, "tool_call_start", { name: tc.name, arguments: tc.arguments });

  // §13.4 — Tool guardrail
  if (guardrails) {
    const parsedArgs = resilientJsonParse(tc.arguments) ?? {};
    const gr = guardrails.checkTool(tc.name, parsedArgs);
    if (!gr.allowed) {
      const deniedMsg = `Tool denied by guardrail: ${gr.reason}`;
      emitEvent(onEvent, "tool_result", { name: tc.name, result: deniedMsg });
      return deniedMsg;
    }
    if (gr.rewrite !== undefined) {
      tc = { ...tc, arguments: typeof gr.rewrite === "string" ? gr.rewrite : JSON.stringify(gr.rewrite) };
    }
  }

  // Execute tool
  let result: string;
  let parsedArgs: unknown;
  try {
    // §9.8 — Resilient JSON parsing for tool arguments
    parsedArgs = resilientJsonParse(tc.arguments);
    if (parsedArgs === null) {
      result = `Error: Tool '${tc.name}' received unparseable arguments`;
      emitEvent(onEvent, "error", { tool: tc.name, error: "Unparseable tool arguments" });
      emitEvent(onEvent, "tool_result", { name: tc.name, result });
      return result;
    }
    if (agent && parentInputs && typeof parsedArgs === "object" && parsedArgs !== null && !Array.isArray(parsedArgs)) {
      parsedArgs = resolveBindings(agent, tc.name, parsedArgs as Record<string, unknown>, parentInputs);
    }
    result = await traceSpan(tc.name, async (toolEmit) => {
      toolEmit("signature", `prompty.tool.${tc.name}`);
      toolEmit("description", `Execute tool: ${tc.name}`);
      toolEmit("inputs", { arguments: parsedArgs, id: tc.id });
      const r = await dispatchTool(tc.name, parsedArgs as Record<string, unknown>, tools, agent, parentInputs);
      toolEmit("result", r);
      return r;
    }) as string;
  } catch (err) {
    // Re-throw cancellation errors
    if (err instanceof CancelledError) throw err;
    const errorMsg = err instanceof Error ? err.message : String(err);
    // §9.9 — Emit error event on tool execution failure
    emitEvent(onEvent, "error", { tool: tc.name, error: errorMsg });
    result = `Error: Tool '${tc.name}' failed: ${errorMsg}`;
  }

  // §13.1 — Emit tool_result
  emitEvent(onEvent, "tool_result", { name: tc.name, result });

  // §9.9 — Emit error event when tool result indicates failure
  if (result.startsWith("Error:")) {
    emitEvent(onEvent, "error", { tool: tc.name, error: result });
  }
  return result;
}

/**
 * Dispatch tool calls with §13 extensions, supporting parallel execution.
 */
async function dispatchToolsWithExtensions(
  toolCalls: { id: string; name: string; arguments: string; [key: string]: string }[],
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs: Record<string, unknown>,
  ext: ToolExtensionOptions,
): Promise<string[]> {
  if (ext.parallel && toolCalls.length > 1) {
    // §13.6 — Parallel tool execution via Promise.all
    return Promise.all(
      toolCalls.map((tc) => dispatchOneToolWithExtensions(tc, tools, agent, parentInputs, ext)),
    );
  }

  // Sequential execution
  const results: string[] = [];
  for (const tc of toolCalls) {
    results.push(await dispatchOneToolWithExtensions(tc, tools, agent, parentInputs, ext));
  }
  return results;
}

/**
 * Build tool result messages from a raw LLM response with §13 extensions.
 */
async function buildToolResultMessagesWithExtensions(
  response: unknown,
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs: Record<string, unknown>,
  parentEmit: ((key: string, value: unknown) => void) | undefined,
  ext: ToolExtensionOptions,
): Promise<Message[]> {
  const { toolCalls, textContent } = extractToolInfo(response);

  const toolResults = await dispatchToolsWithExtensions(toolCalls, tools, agent, parentInputs, ext);

  if (parentEmit) {
    parentEmit("inputs", {
      tool_calls: toolCalls.map((tc, i) => ({ name: tc.name, arguments: tc.arguments, id: tc.id, result: toolResults[i] })),
    });
  }

  const provider = resolveProvider(agent);
  const executor = getExecutor(provider);
  return executor.formatToolMessages(response, toolCalls, toolResults, textContent);
}

/**
 * Build tool result messages from streaming-extracted ToolCall objects with §13 extensions.
 */
async function buildToolMessagesFromCallsWithExtensions(
  toolCalls: ToolCall[],
  textContent: string,
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs: Record<string, unknown>,
  parentEmit: ((key: string, value: unknown) => void) | undefined,
  ext: ToolExtensionOptions,
): Promise<Message[]> {
  const normalizedCalls = toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));

  const toolResults = await dispatchToolsWithExtensions(normalizedCalls, tools, agent, parentInputs, ext);

  if (parentEmit) {
    parentEmit("inputs", {
      tool_calls: normalizedCalls.map((tc, i) => ({ name: tc.name, arguments: tc.arguments, id: tc.id, result: toolResults[i] })),
    });
  }

  const provider = resolveProvider(agent);
  const executor = getExecutor(provider);
  return executor.formatToolMessages(null, normalizedCalls, toolResults, textContent);
}
