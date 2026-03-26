/**
 * Four-step execution pipeline.
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
 * Each leaf step is independently traced. Users can bring their own
 * Renderer, Parser, Executor, Processor via the registry.
 *
 * @module
 */

import type { Prompty } from "../model/prompty.js";
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FORMAT = "nunjucks";
const DEFAULT_PARSER = "prompty";
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MAX_ITERATIONS = 10;

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
  return agent.template?.format?.strict === true;
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
    emit("result", result);
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
    emit("inputs", rendered);
    const messages = await parser.parse(agent, rendered, context);
    emit("result", serializeMessages(messages));
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
  const provider = resolveProvider(agent);
  const processor = getProcessor(provider);

  return traceSpan(processor.constructor?.name ?? "Processor", async (emit) => {
    emit("signature", `prompty.processors.${processor.constructor?.name ?? "Processor"}.process`);
    emit("inputs", response);
    const result = await processor.process(agent, response);
    emit("result", result);
    return result;
  });
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

    // Wrap executor in its own trace span (matching Python's Executor.invoke frame)
    const response = await traceSpan(executor.constructor?.name ?? "Executor", async (execEmit) => {
      execEmit("signature", `prompty.executors.${executor.constructor?.name ?? "Executor"}.execute`);
      execEmit("inputs", serializeMessages(messages));
      const raw = await executor.execute(agent, messages);
      execEmit("result", raw);
      return raw;
    });

    if (options?.raw) {
      emit("result", response);
      return response;
    }
    const result = await process(agent, response);
    emit("result", result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Top-level: execute() = load + prepare + run
// ---------------------------------------------------------------------------

/**
 * Full pipeline: load → prepare → run.
 */
export async function execute(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: { raw?: boolean },
): Promise<unknown> {
  return traceSpan("execute", async (emit) => {
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

    emit("signature", "prompty.execute");
    emit("description", "Execute a prompty");
    emit("inputs", { prompt: serializeAgent(agent), inputs: inputs ?? {} });
    const messages = await prepare(agent, inputs);
    const result = await run(agent, messages, options);
    emit("result", result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Agent loop: executeAgent()
// ---------------------------------------------------------------------------

/**
 * Run a prompt with automatic tool-call execution loop.
 */
export async function executeAgent(
  prompt: string | Prompty,
  inputs?: Record<string, unknown>,
  options?: {
    tools?: Record<string, (...args: unknown[]) => unknown>;
    maxIterations?: number;
    raw?: boolean;
  },
): Promise<unknown> {
  return traceSpan("executeAgent", async (emit) => {
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

    emit("signature", "prompty.executeAgent");
    emit("description", "Execute a prompty with tool calling");
    emit("inputs", { prompt: serializeAgent(agent), tools: Object.keys(tools), inputs: inputs ?? {} });

    const messages = await prepare(agent, inputs);
    const provider = resolveProvider(agent);
    const executor = getExecutor(provider);

    let response = await executor.execute(agent, messages);
    let iteration = 0;

    while (hasToolCalls(response)) {
      iteration++;
      if (iteration > maxIterations) {
        throw new Error(
          `Agent loop exceeded maxIterations (${maxIterations}). ` +
          `The model kept requesting tool calls. Increase maxIterations or check your tools.`,
        );
      }

      const toolMessages = buildToolResultMessages(response, tools);
      messages.push(...toolMessages);
      response = await executor.execute(agent, messages);
    }

    emit("iterations", iteration);

    if (options?.raw) {
      emit("result", response);
      return response;
    }
    const result = await process(agent, response);
    emit("result", result);
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

  // OpenAI ChatCompletion shape
  const choices = r.choices as unknown[] | undefined;
  if (!Array.isArray(choices) || choices.length === 0) return false;

  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown> | undefined;
  if (!message) return false;

  const toolCalls = message.tool_calls as unknown[] | undefined;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

function buildToolResultMessages(
  response: unknown,
  tools: Record<string, (...args: unknown[]) => unknown>,
): Message[] {
  const r = response as Record<string, unknown>;
  const choices = r.choices as unknown[];
  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown>;
  const toolCalls = message.tool_calls as Record<string, unknown>[];

  const messages: Message[] = [];

  // First, add assistant message with tool_calls metadata
  const assistantContent = (message.content as string) ?? "";
  messages.push(
    new Message("assistant", assistantContent ? [text(assistantContent)] : [], {
      tool_calls: toolCalls,
    }),
  );

  // Then, execute each tool and build tool result messages
  for (const tc of toolCalls) {
    const fn = tc.function as Record<string, unknown>;
    const toolName = fn.name as string;
    const toolCallId = tc.id as string;

    let result: string;
    try {
      const args = JSON.parse(fn.arguments as string);
      const toolFn = tools[toolName];
      if (!toolFn) {
        result = `Error: tool "${toolName}" not found`;
      } else {
        const toolResult = toolFn(...(Array.isArray(args) ? args : [args]));
        result = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    messages.push(
      new Message("tool", [text(result)], {
        tool_call_id: toolCallId,
        name: toolName,
      }),
    );
  }

  return messages;
}

// Backward-compatibility alias
export const runAgent = executeAgent;
