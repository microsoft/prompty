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
 * Dispatches to the correct wire format based on provider and apiType.
 */
async function buildToolMessagesFromCalls(
  toolCalls: ToolCall[],
  textContent: string,
  tools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const provider = resolveProvider(agent);
  const apiType = agent.model?.apiType || "chat";
  const messages: Message[] = [];
  const toolInputs: Record<string, unknown>[] = [];

  // --- Assistant message with provider-appropriate metadata ---
  if (provider === "anthropic") {
    // Anthropic: raw content blocks (text + tool_use)
    const rawContent: Record<string, unknown>[] = [];
    if (textContent) rawContent.push({ type: "text", text: textContent });
    for (const tc of toolCalls) {
      rawContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: JSON.parse(tc.arguments),
      });
    }
    messages.push(
      new Message("assistant", textContent ? [text(textContent)] : [], { content: rawContent }),
    );
  } else if (apiType === "responses") {
    // Responses API: individual function_call items
    for (const tc of toolCalls) {
      messages.push(
        new Message("assistant", [], {
          responses_function_call: {
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          },
        }),
      );
    }
  } else {
    // OpenAI Chat: tool_calls metadata
    const rawToolCalls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
    messages.push(
      new Message("assistant", textContent ? [text(textContent)] : [], {
        tool_calls: rawToolCalls,
      }),
    );
  }

  // --- Execute tools and build result messages ---
  const toolResultBlocks: Record<string, unknown>[] = [];

  for (const tc of toolCalls) {
    let result: string;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(tc.arguments);
      const toolFn = tools[tc.name];
      if (!toolFn) {
        result = `Error: tool "${tc.name}" not found`;
      } else {
        const toolResult = await traceSpan(tc.name, async (toolEmit) => {
          toolEmit("signature", `prompty.tool.${tc.name}`);
          toolEmit("description", `Execute tool: ${tc.name}`);
          toolEmit("inputs", { arguments: parsedArgs, id: tc.id });
          const r = await toolFn(...(Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs]));
          const str = typeof r === "string" ? r : JSON.stringify(r);
          toolEmit("result", str);
          return str;
        });
        result = toolResult as string;
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolInputs.push({ name: tc.name, arguments: parsedArgs, id: tc.id, result });

    if (provider === "anthropic") {
      toolResultBlocks.push({ type: "tool_result", tool_use_id: tc.id, content: result });
    } else {
      messages.push(
        new Message("tool", [text(result)], { tool_call_id: tc.id, name: tc.name }),
      );
    }
  }

  // Anthropic: batch all tool results in single user message
  if (provider === "anthropic" && toolResultBlocks.length > 0) {
    messages.push(new Message("user", [], { tool_results: toolResultBlocks }));
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  return messages;
}

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

    while (true) {
      // Streaming: consume the stream, extract tool calls from buffered chunks
      if (isAsyncIterable(response)) {
        const { toolCalls, content } = await consumeStream(agent, response);

        if (toolCalls.length === 0) {
          // Final answer — return collected content
          emit("iterations", iteration);
          emit("result", content);
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
          toolEmit("signature", "prompty.executeAgent.toolCalls");
          toolEmit("description", `Tool call round ${iteration}`);
          const result = await buildToolMessagesFromCalls(toolCalls, content, tools, agent, toolEmit);
          toolEmit("result", result.map((m) => ({ role: m.role, content: m.parts.map((p) => (p as { value?: string }).value ?? "").join(""), metadata: m.metadata })));
          return result;
        });

        messages.push(...toolMessages);
        response = await executor.execute(agent, messages);
        continue;
      }

      // Non-streaming: check raw response for tool calls
      if (!hasToolCalls(response)) break;

      iteration++;
      if (iteration > maxIterations) {
        throw new Error(
          `Agent loop exceeded maxIterations (${maxIterations}). ` +
          `The model kept requesting tool calls. Increase maxIterations or check your tools.`,
        );
      }

      const toolMessages = await traceSpan("toolCalls", async (toolEmit) => {
        toolEmit("signature", "prompty.executeAgent.toolCalls");
        toolEmit("description", `Tool call round ${iteration}`);
        const result = await buildToolResultMessages(response, tools, toolEmit);
        toolEmit("result", result.map((m) => ({ role: m.role, content: m.parts.map((p) => (p as { value?: string }).value ?? "").join(""), metadata: m.metadata })));
        return result;
      });

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

async function buildToolResultMessages(
  response: unknown,
  tools: Record<string, (...args: unknown[]) => unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const r = response as Record<string, unknown>;

  // Detect response format and dispatch
  if (Array.isArray(r.content) && r.stop_reason === "tool_use") {
    return buildAnthropicToolResultMessages(r, tools, parentEmit);
  }

  // OpenAI Responses API: output[].type === "function_call"
  if (r.object === "response" && Array.isArray(r.output)) {
    return buildResponsesToolResultMessages(r, tools, parentEmit);
  }

  return buildOpenAIToolResultMessages(r, tools, parentEmit);
}

/** Handle OpenAI ChatCompletion tool calls: choices[0].message.tool_calls */
async function buildOpenAIToolResultMessages(
  r: Record<string, unknown>,
  tools: Record<string, (...args: unknown[]) => unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
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

  const toolInputs: Record<string, unknown>[] = [];

  // Then, execute each tool and build tool result messages
  for (const tc of toolCalls) {
    const fn = tc.function as Record<string, unknown>;
    const toolName = fn.name as string;
    const toolCallId = tc.id as string;

    let result: string;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(fn.arguments as string);
      const toolFn = tools[toolName];
      if (!toolFn) {
        result = `Error: tool "${toolName}" not found`;
      } else {
        const toolResult = await traceSpan(toolName, async (toolEmit) => {
          toolEmit("signature", `prompty.tool.${toolName}`);
          toolEmit("description", `Execute tool: ${toolName}`);
          toolEmit("inputs", { arguments: parsedArgs, tool_call_id: toolCallId });
          const r = await toolFn(...(Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs]));
          const str = typeof r === "string" ? r : JSON.stringify(r);
          toolEmit("result", str);
          return str;
        });
        result = toolResult as string;
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolInputs.push({ name: toolName, arguments: parsedArgs, tool_call_id: toolCallId, result });

    messages.push(
      new Message("tool", [text(result)], {
        tool_call_id: toolCallId,
        name: toolName,
      }),
    );
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  return messages;
}

/** Handle Anthropic Messages tool calls: content[].type === "tool_use" */
async function buildAnthropicToolResultMessages(
  r: Record<string, unknown>,
  tools: Record<string, (...args: unknown[]) => unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const content = r.content as Record<string, unknown>[];
  const toolUseBlocks = content.filter((block) => block.type === "tool_use");

  const messages: Message[] = [];

  // Add assistant message with the FULL content blocks (including tool_use).
  // Anthropic requires the assistant message to contain the original tool_use
  // blocks so the API can match tool_result blocks to their tool_use origins.
  const textParts = content
    .filter((block) => block.type === "text")
    .map((block) => text(block.text as string));
  messages.push(
    new Message("assistant", textParts, { content }),
  );

  const toolInputs: Record<string, unknown>[] = [];
  const toolResultBlocks: Record<string, unknown>[] = [];

  for (const block of toolUseBlocks) {
    const toolName = block.name as string;
    const toolCallId = block.id as string;
    const toolArgs = block.input as Record<string, unknown>;

    let result: string;
    try {
      const toolFn = tools[toolName];
      if (!toolFn) {
        result = `Error: tool "${toolName}" not found`;
      } else {
        const toolResult = await traceSpan(toolName, async (toolEmit) => {
          toolEmit("signature", `prompty.tool.${toolName}`);
          toolEmit("description", `Execute tool: ${toolName}`);
          toolEmit("inputs", { arguments: toolArgs, tool_use_id: toolCallId });
          const r = await toolFn(...(Array.isArray(toolArgs) ? toolArgs : [toolArgs]));
          const str = typeof r === "string" ? r : JSON.stringify(r);
          toolEmit("result", str);
          return str;
        });
        result = toolResult as string;
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolInputs.push({ name: toolName, arguments: toolArgs, tool_use_id: toolCallId, result });

    // Collect tool_result blocks for batching into a single user message
    toolResultBlocks.push({
      type: "tool_result",
      tool_use_id: toolCallId,
      content: result,
    });
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  // Anthropic requires ALL tool results in a SINGLE user message
  // with the tool_result content blocks batched together.
  messages.push(
    new Message("user", [], { tool_results: toolResultBlocks }),
  );

  return messages;
}

/** Handle OpenAI Responses API tool calls: output[].type === "function_call" */
async function buildResponsesToolResultMessages(
  r: Record<string, unknown>,
  tools: Record<string, (...args: unknown[]) => unknown>,
  parentEmit?: (key: string, value: unknown) => void,
): Promise<Message[]> {
  const output = r.output as Record<string, unknown>[];
  const funcCalls = output.filter((item) => item.type === "function_call");

  const messages: Message[] = [];
  const toolInputs: Record<string, unknown>[] = [];

  for (const fc of funcCalls) {
    const toolName = fc.name as string;
    const callId = (fc.call_id ?? fc.id ?? "") as string;
    const argsStr = (fc.arguments as string) ?? "{}";

    // Include the original function_call item so the Responses API can match
    // function_call_output items to their origin function_call
    messages.push(
      new Message("assistant", [], {
        responses_function_call: {
          type: "function_call",
          call_id: callId,
          name: toolName,
          arguments: argsStr,
        },
      }),
    );

    let result: string;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(argsStr);
      const toolFn = tools[toolName];
      if (!toolFn) {
        result = `Error: tool "${toolName}" not found`;
      } else {
        const toolResult = await traceSpan(toolName, async (toolEmit) => {
          toolEmit("signature", `prompty.tool.${toolName}`);
          toolEmit("description", `Execute tool: ${toolName}`);
          toolEmit("inputs", { arguments: parsedArgs, call_id: callId });
          const r = await toolFn(...(Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs]));
          const str = typeof r === "string" ? r : JSON.stringify(r);
          toolEmit("result", str);
          return str;
        });
        result = toolResult as string;
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    toolInputs.push({ name: toolName, arguments: parsedArgs, call_id: callId, result });

    // Responses API tool results use tool_call_id metadata so the wire format
    // (messageToResponsesInput) maps them to { type: "function_call_output", call_id, output }
    messages.push(
      new Message("tool", [text(result)], {
        tool_call_id: callId,
        name: toolName,
      }),
    );
  }

  if (parentEmit) {
    parentEmit("inputs", { tool_calls: toolInputs });
  }

  return messages;
}

// Backward-compatibility alias
export const runAgent = executeAgent;
