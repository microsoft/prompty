/**
 * Four-step execution pipeline.
 *
 * ```
 * invoke(prompt, inputs)               → top-level orchestrator
 *   ├── prepare(agent, inputs)         → template → wire format
 *   │     ├── render(agent, inputs)    → template + inputs → rendered string
 *   │     └── parse(agent, rendered)   → rendered string → Message[]
 *   └── run(agent, messages)           → LLM call → clean result
 *         ├── Executor.execute(...)    → messages → raw LLM response
 *         └── process(agent, response) → raw response → clean result
 * ```
 *
 * Each leaf step is independently traced. Users can bring their own
 * Renderer, Parser, Executor, Processor via the registry.
 *
 * @module
 */

import { Prompty } from "../model/prompty.js";
import { Model } from "../model/model.js";
import { ModelOptions } from "../model/model-options.js";
import {
  type ContentPart,
  type ToolCall,
  type Role,
  Message,
  ThreadMarker,
  RICH_KINDS,
  dictToMessage,
  text,
} from "./types.js";
import { getRenderer, getParser, getExecutor, getProcessor } from "./registry.js";
import { getLastNonces, clearLastNonces } from "../renderers/common.js";
import { traceSpan, sanitizeValue } from "../tracing/tracer.js";
import { load } from "./loader.js";
import { dispatchTool } from "./tool-dispatch.js";
import { type EventCallback, emitEvent } from "./agent-events.js";
import { CancelledError, checkCancellation } from "./cancellation.js";
import { trimToContextWindow } from "./context.js";
import { type GuardrailResult, GuardrailError, Guardrails } from "./guardrails.js";
import { Steering } from "./steering.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FORMAT = "nunjucks";
const DEFAULT_PARSER = "prompty";
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MAX_ITERATIONS = 10;

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
// Top-level: invoke() = load + prepare + run
// ---------------------------------------------------------------------------

/**
 * Full pipeline: load → prepare → run.
 */
export async function invoke(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: { raw?: boolean },
): Promise<unknown> {
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
    const messages = await prepare(agent, inputs);
    const result = await run(agent, messages, options);
    emit("result", result);
    return result;
  });
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
// Agent loop: invokeAgent()
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
      }
    }
  } else if (typeof processed === "string") {
    textParts.push(processed);
  }

  return { toolCalls, content: textParts.join("") };
}

/**
 * Build tool result messages from processed ToolCall objects (streaming path).
 * Dispatches tools, then delegates message formatting to the provider's executor.
 */
async function buildToolMessagesFromCalls(
  toolCalls: ToolCall[],
  textContent: string,
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs?: Record<string, unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const toolResults: string[] = [];
  const toolInputs: Record<string, unknown>[] = [];

  for (const tc of toolCalls) {
    let result: string;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(tc.arguments);
      // Resolve bindings: inject values from parentInputs
      if (parentInputs && typeof parsedArgs === "object" && parsedArgs !== null && !Array.isArray(parsedArgs)) {
        parsedArgs = resolveBindings(agent, tc.name, parsedArgs as Record<string, unknown>, parentInputs);
      }
      result = await traceSpan(tc.name, async (toolEmit) => {
        toolEmit("signature", `prompty.tool.${tc.name}`);
        toolEmit("description", `Execute tool: ${tc.name}`);
        toolEmit("inputs", { arguments: parsedArgs, id: tc.id });
        const r = await dispatchTool(tc.name, parsedArgs as Record<string, unknown>, tools, agent, parentInputs ?? {});
        toolEmit("result", r);
        return r;
      }) as string;
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolResults.push(result);
    toolInputs.push({ name: tc.name, arguments: parsedArgs, id: tc.id, result });
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  // Delegate message formatting to executor
  const provider = resolveProvider(agent);
  const executor = getExecutor(provider);
  const normalizedCalls = toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
  return executor.formatToolMessages(null, normalizedCalls, toolResults, textContent);
}

/**
 * Run a prompt with automatic tool-call execution loop.
 *
 * Supports §13 extensions: events, cancellation, context window
 * management, guardrails, steering, and parallel tool calls.
 */
export async function invokeAgent(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: {
    tools?: Record<string, (...args: unknown[]) => unknown>;
    maxIterations?: number;
    raw?: boolean;
    onEvent?: EventCallback;
    signal?: AbortSignal;
    contextBudget?: number;
    guardrails?: Guardrails;
    steering?: Steering;
    parallelToolCalls?: boolean;
  },
): Promise<unknown> {
  return traceSpan("invokeAgent", async (emit) => {
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
    const tools = options?.tools ?? {};
    const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const onEvent = options?.onEvent;
    const signal = options?.signal;
    const contextBudget = options?.contextBudget;
    const guardrails = options?.guardrails;
    const steering = options?.steering;
    const parallelToolCalls = options?.parallelToolCalls ?? false;

    emit("signature", "prompty.invokeAgent");
    emit("description", "Invoke a prompty with tool calling");
    emit("inputs", { prompt: serializeAgent(agent), tools: Object.keys(tools), inputs: inputs ?? {} });

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

      // Call LLM
      response = await executor.execute(agent, messages);

      // Streaming: consume the stream, extract tool calls from buffered chunks
      if (isAsyncIterable(response)) {
        const { toolCalls, content } = await consumeStream(agent, response);

        // §13.4 — Output guardrail (on assistant content, both final and tool-call responses)
        if (guardrails && content) {
          const assistantMsg = new Message("assistant", [text(content)]);
          const gr = guardrails.checkOutput(assistantMsg);
          if (!gr.allowed) {
            emitEvent(onEvent, "error", { message: `Output guardrail denied: ${gr.reason}` });
            throw new GuardrailError(gr.reason ?? "Output guardrail denied");
          }
        }

        if (toolCalls.length === 0) {
          // Final answer — return collected content
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
          toolEmit("signature", "prompty.invokeAgent.toolCalls");
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
        // §13.4 — Output guardrail on final response
        if (guardrails) {
          const finalResult = options?.raw ? response : await process(agent, response);
          if (typeof finalResult === "string") {
            const assistantMsg = new Message("assistant", [text(finalResult)]);
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
        break;
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
        toolEmit("signature", "prompty.invokeAgent.toolCalls");
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

    emit("iterations", iteration);

    if (options?.raw) {
      emit("result", response);
      emitEvent(onEvent, "done", { response, messages });
      return response;
    }
    const result = await process(agent, response);
    emit("result", result);
    emitEvent(onEvent, "done", { response: result, messages });
    return result;
  });
}

// ---------------------------------------------------------------------------
// Thread marker helpers
// ---------------------------------------------------------------------------

/**
 * Get map of `{propertyName: kind}` for inputs with rich kinds.
 */
function getRichInputNames(agent: Prompty): Record<string, string> {
  const result: Record<string, string> = {};
  const props = agent.inputs;
  if (!props || props.length === 0) return result;

  for (const prop of props) {
    const kind = prop.kind?.toLowerCase() ?? "";
    if (RICH_KINDS.has(kind) && prop.name) {
      result[prop.name] = kind;
    }
  }
  return result;
}

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

/**
 * Build tool result messages from a raw LLM response (non-streaming path).
 * Extracts tool call info, dispatches tools, then delegates message
 * formatting to the provider's executor.
 */
async function buildToolResultMessages(
  response: unknown,
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent?: Prompty,
  parentInputs?: Record<string, unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const { toolCalls, textContent } = extractToolInfo(response);
  const toolResults: string[] = [];
  const toolInputs: Record<string, unknown>[] = [];

  for (const tc of toolCalls) {
    let result: string;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(tc.arguments);
      // Resolve bindings: inject values from parentInputs
      if (agent && parentInputs && typeof parsedArgs === "object" && parsedArgs !== null && !Array.isArray(parsedArgs)) {
        parsedArgs = resolveBindings(agent, tc.name, parsedArgs as Record<string, unknown>, parentInputs);
      }
      result = await traceSpan(tc.name, async (toolEmit) => {
        toolEmit("signature", `prompty.tool.${tc.name}`);
        toolEmit("description", `Execute tool: ${tc.name}`);
        toolEmit("inputs", { arguments: parsedArgs, id: tc.id });
        const r = await dispatchTool(tc.name, parsedArgs as Record<string, unknown>, tools, agent ?? ({} as Prompty), parentInputs ?? {});
        toolEmit("result", r);
        return r;
      }) as string;
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolResults.push(result);
    toolInputs.push({ name: tc.name, arguments: parsedArgs, id: tc.id, result });
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  // Delegate message formatting to executor
  const provider = resolveProvider(agent ?? ({} as Prompty));
  const executor = getExecutor(provider);
  return executor.formatToolMessages(response, toolCalls, toolResults, textContent);
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
    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(tc.arguments);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        parsedArgs = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore parse errors for guardrail check
    }
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
    parsedArgs = JSON.parse(tc.arguments);
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
    result = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // §13.1 — Emit tool_result
  emitEvent(onEvent, "tool_result", { name: tc.name, result });
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
