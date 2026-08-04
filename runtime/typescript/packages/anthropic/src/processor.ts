/**
 * Anthropic processor — extracts clean results from Anthropic Messages API responses.
 *
 * Handles:
 * - Text content from `content[]` blocks
 * - Tool use blocks → ToolCall objects
 * - Streaming responses (content_block_delta events)
 * - Structured output (JSON parse when outputs are present)
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
  ThinkingChunk,
  ToolChunk,
  UsageChunk,
  traceSpan,
} from "@prompty/core";
import { createStructuredResult } from "@prompty/core";

export class AnthropicProcessor implements Processor {
  async process(agent: Prompty, response: unknown): Promise<unknown> {
    return traceSpan("AnthropicProcessor", async (emit) => {
      emit("signature", "prompty.anthropic.processor.AnthropicProcessor.invoke");
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
 * Extract clean content from an Anthropic Messages API response.
 */
export function processResponse(agent: Prompty, response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;

  // Streaming response — return content-extracting async generator
  if (isAsyncIterable(response)) {
    return legacyStreamGenerator(processStream(response));
  }

  const r = response as Record<string, unknown>;

  // Anthropic Messages response — has `content` array and `role`
  if (Array.isArray(r.content) && r.role === "assistant") {
    return processMessages(agent, r);
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
 * Yield content chunks from an Anthropic streaming response.
 *
 * Anthropic streaming events include:
 * - `content_block_delta` with `delta.type === "text_delta"` → yield text
 * - `content_block_start` with `content_block.type === "tool_use"` → accumulate tool call
 * - `input_json` deltas for tool arguments
 * - `message_stop` → end of stream
 *
 * Tool calls are accumulated and yielded at the end of the stream.
 */
export async function* processStream(
  response: AsyncIterable<unknown>,
): AsyncGenerator<StreamChunk> {
  const toolCallAcc: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  try {
    for await (const event of response) {
      const e = event as Record<string, unknown>;
      const eventType = e.type as string | undefined;

      if (eventType === "message_start") {
        const message = e.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, unknown> | undefined;
        inputTokens = numberValue(usage?.input_tokens) ?? inputTokens;
      } else if (eventType === "message_delta") {
        const usage = e.usage as Record<string, unknown> | undefined;
        outputTokens = numberValue(usage?.output_tokens) ?? outputTokens;
      } else if (eventType === "content_block_delta") {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
          yield new TextChunk({ value: delta.text });
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
          yield new ThinkingChunk({ value: delta.thinking });
        } else if (delta.type === "input_json_delta") {
          const idx = typeof e.index === "number" ? e.index : 0;
          const acc = toolCallAcc.get(idx);
          if (acc && typeof delta.partial_json === "string") {
            acc.arguments += delta.partial_json;
          }
        }
      } else if (eventType === "content_block_start") {
        const block = e.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          const idx = typeof e.index === "number" ? e.index : 0;
          toolCallAcc.set(idx, {
            id: stringValue(block.id),
            name: stringValue(block.name),
            arguments: "",
          });
        }
      } else if (eventType === "error") {
        const error = e.error as Record<string, unknown> | undefined;
        yield new ErrorChunk({
          message: stringValue(error?.message) || "Anthropic stream failed",
        });
        return;
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
  if (inputTokens !== undefined || outputTokens !== undefined) {
    const input = inputTokens ?? 0;
    const output = outputTokens ?? 0;
    yield new UsageChunk({
      usage: new InvocationUsage({
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
      }),
    });
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Non-streaming response processing
// ---------------------------------------------------------------------------

/**
 * Process an Anthropic Messages API response.
 *
 * Response shape:
 * ```json
 * {
 *   "role": "assistant",
 *   "content": [
 *     { "type": "text", "text": "..." },
 *     { "type": "tool_use", "id": "...", "name": "...", "input": {...} }
 *   ],
 *   "stop_reason": "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
 * }
 * ```
 */
function processMessages(
  agent: Prompty,
  response: Record<string, unknown>,
): unknown {
  const content = response.content as Record<string, unknown>[];
  if (!content || content.length === 0) return null;

  // Check for tool_use blocks
  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id as string,
        name: block.name as string,
        arguments:
          typeof block.input === "string"
            ? (block.input as string)
            : JSON.stringify(block.input),
      });
    } else if (block.type === "text") {
      textParts.push(block.text as string);
    }
  }

  // If tool calls present, return them (pipeline handles the loop)
  if (toolCalls.length > 0) {
    return toolCalls;
  }

  // Text content
  const text = textParts.join("");
  if (!text) return null;

  // Structured output — JSON parse when outputs schema exists
  if (agent.outputs && agent.outputs.length > 0) {
    try {
      return createStructuredResult(JSON.parse(text) as Record<string, unknown>, text);
    } catch {
      return text;
    }
  }

  return text;
}
