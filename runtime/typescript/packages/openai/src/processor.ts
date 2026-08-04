/**
 * OpenAI processor — extracts clean results from raw OpenAI responses.
 *
 * Handles ChatCompletion, Embedding, Image, and streaming responses.
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { Processor } from "@prompty/core";
import type { ToolCall } from "@prompty/core";
import {
  ErrorChunk,
  InvocationUsage,
  StreamChunk,
  TextChunk,
  ToolChunk,
  UsageChunk,
  traceSpan,
} from "@prompty/core";
import { createStructuredResult } from "@prompty/core";

export class OpenAIProcessor implements Processor {
  async process(agent: Prompty, response: unknown): Promise<unknown> {
    return traceSpan("OpenAIProcessor", async (emit) => {
      emit("signature", "prompty.openai.processor.OpenAIProcessor.invoke");
      emit("inputs", { data: response });
      const result = processResponse(agent, response);
      // Don't emit result for streaming — it's a generator, not a value
      if (!isAsyncIterable(response)) {
        emit("result", result);
      }
      return result;
    });
  }

  processStream(response: AsyncIterable<unknown>): AsyncIterable<StreamChunk> {
    return processStream(response);
  }
}

/**
 * Extract clean content from an OpenAI response.
 */
export function processResponse(agent: Prompty, response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;

  // Streaming response — return content-extracting async generator
  if (isAsyncIterable(response)) {
    return legacyStreamGenerator(processStream(response));
  }

  const r = response as Record<string, unknown>;

  // Responses API — has output[] and object === "response"
  if (r.object === "response" && Array.isArray(r.output)) {
    return processResponsesApi(agent, r);
  }

  // ChatCompletion
  if (r.choices) {
    return processChatCompletion(agent, r);
  }

  // Embedding response
  if (r.data && r.object === "list") {
    return processEmbedding(r);
  }

  // Image response
  if (r.data && Array.isArray(r.data)) {
    const data = r.data as Record<string, unknown>[];
    if (data.length > 0 && ("url" in data[0] || "b64_json" in data[0])) {
      return processImage(r);
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Type guard for async iterables (PromptyStream or raw SDK stream). */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

/**
 * Yield content chunks, tool calls, or refusals from a streaming response.
 *
 * Handles three types of streaming deltas:
 * - `delta.content` — yields content strings
 * - `delta.tool_calls` — accumulates partial tool call chunks,
 *   yields ToolCall objects when the stream ends
 * - `delta.refusal` — throws Error with the refusal message
 *
 * Matches the Python `_stream_generator` / `_async_stream_generator`.
 */
export async function* processStream(
  response: AsyncIterable<unknown>,
): AsyncGenerator<StreamChunk> {
  const toolCallAcc: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let usage: InvocationUsage | undefined;

  try {
    for await (const chunk of response) {
      const c = chunk as Record<string, unknown>;
      const error = c.error as Record<string, unknown> | undefined;
      if (error) {
        yield new ErrorChunk({
          message: typeof error.message === "string" ? error.message : "OpenAI stream failed",
        });
        return;
      }

      const eventType = c.type as string | undefined;
      if (eventType === "response.output_text.delta" && typeof c.delta === "string" && c.delta) {
        yield new TextChunk({ value: c.delta });
      } else if (
        (eventType === "response.output_item.added" || eventType === "response.output_item.done") &&
        isRecord(c.item) &&
        c.item.type === "function_call"
      ) {
        const idx = typeof c.output_index === "number" ? c.output_index : toolCallAcc.size;
        toolCallAcc.set(idx, {
          id: stringValue(c.item.call_id ?? c.item.id),
          name: stringValue(c.item.name),
          arguments: stringValue(c.item.arguments),
        });
      } else if (eventType === "response.function_call_arguments.delta") {
        appendResponsesArguments(toolCallAcc, c, false);
      } else if (eventType === "response.function_call_arguments.done") {
        appendResponsesArguments(toolCallAcc, c, true);
      } else if (eventType === "response.completed" && isRecord(c.response)) {
        usage = usageFromWire(c.response.usage);
        const output = c.response.output;
        if (Array.isArray(output)) {
          for (const [idx, item] of output.entries()) {
            if (isRecord(item) && item.type === "function_call") {
              toolCallAcc.set(idx, {
                id: stringValue(item.call_id ?? item.id),
                name: stringValue(item.name),
                arguments: stringValue(item.arguments),
              });
            }
          }
        }
      } else if (eventType === "response.refusal.delta" && typeof c.delta === "string" && c.delta) {
        yield new ErrorChunk({ message: `Model refused: ${c.delta}` });
        return;
      }

      usage = usageFromWire(c.usage) ?? usage;

      const choices = c.choices as Record<string, unknown>[] | undefined;
      if (choices && choices.length > 0) {
        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (delta) {
          if (typeof delta.content === "string" && delta.content) {
            yield new TextChunk({ value: delta.content });
          }

          const tcDeltas = delta.tool_calls as Record<string, unknown>[] | undefined;
          if (tcDeltas) {
            for (const tcDelta of tcDeltas) {
              const idx = typeof tcDelta.index === "number" ? tcDelta.index : 0;
              const acc = toolCallAcc.get(idx) ?? { id: "", name: "", arguments: "" };
              if (tcDelta.id) acc.id = stringValue(tcDelta.id);
              const fn = tcDelta.function as Record<string, unknown> | undefined;
              if (fn) {
                if (fn.name) acc.name = stringValue(fn.name);
                if (fn.arguments) acc.arguments += stringValue(fn.arguments);
              }
              toolCallAcc.set(idx, acc);
            }
          }

          if (typeof delta.refusal === "string" && delta.refusal) {
            yield new ErrorChunk({ message: `Model refused: ${delta.refusal}` });
            return;
          }
        }
      }
    }
  } catch (error) {
    yield new ErrorChunk({
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const sortedIndices = [...toolCallAcc.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const tc = toolCallAcc.get(idx)!;
    yield ToolChunk.load({ kind: "tool", toolCall: tc });
  }
  if (usage) {
    yield new UsageChunk({ usage });
  }
}

async function* legacyStreamGenerator(
  chunks: AsyncIterable<StreamChunk>,
): AsyncGenerator<string | ToolCall> {
  for await (const chunk of chunks) {
    if (chunk instanceof TextChunk) {
      yield chunk.value;
    } else if (chunk instanceof ToolChunk) {
      yield chunk.toolCall;
    } else if (chunk instanceof ErrorChunk) {
      throw new Error(chunk.message);
    }
  }
}

function appendResponsesArguments(
  calls: Map<number, { id: string; name: string; arguments: string }>,
  chunk: Record<string, unknown>,
  replace: boolean,
): void {
  const callId = stringValue(chunk.call_id);
  const entry = [...calls.values()].find((call) => call.id === callId);
  if (!entry) return;
  const value = stringValue(replace ? chunk.arguments : chunk.delta);
  entry.arguments = replace ? value : entry.arguments + value;
}

function usageFromWire(value: unknown): InvocationUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = numberValue(value.input_tokens ?? value.prompt_tokens);
  const output = numberValue(value.output_tokens ?? value.completion_tokens);
  if (input === undefined && output === undefined) return undefined;
  return new InvocationUsage({
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    totalTokens: numberValue(value.total_tokens) ?? (input ?? 0) + (output ?? 0),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Responses API processing
// ---------------------------------------------------------------------------

/**
 * Process a Responses API response.
 *
 * Extracts:
 * - Text content from `output_text` or output message items
 * - Function tool calls from `function_call` output items
 * - JSON-parsed content when outputs is present
 */
function processResponsesApi(
  agent: Prompty,
  response: Record<string, unknown>,
): unknown {
  const output = response.output as Record<string, unknown>[];

  // Collect function calls
  const funcCalls: ToolCall[] = [];
  for (const item of output) {
    if (item.type === "function_call") {
      funcCalls.push({
        id: (item.call_id ?? item.id ?? "") as string,
        name: item.name as string,
        arguments: item.arguments as string,
      });
    }
  }

  if (funcCalls.length > 0) {
    return funcCalls;
  }

  // Text content — use output_text convenience field
  const outputText = response.output_text as string | undefined;
  if (outputText !== undefined) {
    // Structured output — JSON parse when outputs schema exists
    if (agent.outputs && agent.outputs.length > 0) {
      try {
        return createStructuredResult(JSON.parse(outputText) as Record<string, unknown>, outputText);
      } catch {
        return outputText;
      }
    }
    return outputText;
  }

  // Fallback: extract from output message items
  const texts: string[] = [];
  for (const item of output) {
    if (item.type === "message") {
      const content = item.content as Record<string, unknown>[] | undefined;
      if (content) {
        for (const part of content) {
          if (part.type === "output_text" || part.type === "text") {
            texts.push(part.text as string);
          }
        }
      }
    }
  }

  if (texts.length > 0) {
    const text = texts.join("");
    if (agent.outputs && agent.outputs.length > 0) {
      try {
        return createStructuredResult(JSON.parse(text) as Record<string, unknown>, text);
      } catch {
        return text;
      }
    }
    return text;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Non-streaming response processing
// ---------------------------------------------------------------------------

function processChatCompletion(
  agent: Prompty,
  response: Record<string, unknown>,
): unknown {
  const choices = response.choices as Record<string, unknown>[];
  if (!choices || choices.length === 0) return null;

  const choice = choices[0];
  const message = choice.message as Record<string, unknown>;
  if (!message) return null;

  // Tool calls
  const toolCalls = message.tool_calls as Record<string, unknown>[] | undefined;
  if (toolCalls && toolCalls.length > 0) {
    return toolCalls.map((tc): ToolCall => {
      const fn = tc.function as Record<string, unknown>;
      return {
        id: tc.id as string,
        name: fn.name as string,
        arguments: fn.arguments as string,
      };
    });
  }

  // Content
  const content = message.content as string | null;

  // Refusal — when content is null but refusal is present, return the refusal
  if (content === null) {
    const refusal = message.refusal as string | undefined;
    if (typeof refusal === "string") return refusal;
    return null;
  }

  // Structured output — JSON parse when outputs schema exists
  if (agent.outputs && agent.outputs.length > 0) {
    try {
      return createStructuredResult(JSON.parse(content) as Record<string, unknown>, content);
    } catch {
      return content;
    }
  }

  return content;
}

function processEmbedding(response: Record<string, unknown>): unknown {
  const data = response.data as Record<string, unknown>[];
  if (data.length === 1) {
    return (data[0] as Record<string, unknown>).embedding;
  }
  return data.map((d) => (d as Record<string, unknown>).embedding);
}

function processImage(response: Record<string, unknown>): unknown {
  const data = response.data as Record<string, unknown>[];
  if (data.length === 1) {
    return data[0].url ?? data[0].b64_json;
  }
  return data.map((d) => d.url ?? d.b64_json);
}
