/**
 * Anthropic processor — extracts clean results from Anthropic Messages API responses.
 *
 * Handles:
 * - Text content from `content[]` blocks
 * - Tool use blocks → ToolCall objects
 * - Streaming responses (content_block_delta events)
 * - Structured output (JSON parse when outputSchema present)
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { Processor } from "@prompty/core";
import type { ToolCall } from "@prompty/core";
import { traceSpan } from "@prompty/core";

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
}

/**
 * Extract clean content from an Anthropic Messages API response.
 */
export function processResponse(agent: Prompty, response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;

  // Streaming response — return content-extracting async generator
  if (isAsyncIterable(response)) {
    return streamGenerator(response);
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
async function* streamGenerator(
  response: AsyncIterable<unknown>,
): AsyncGenerator<string | ToolCall> {
  const toolCallAcc: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  for await (const event of response) {
    const e = event as Record<string, unknown>;
    const eventType = e.type as string | undefined;

    if (eventType === "content_block_delta") {
      const delta = e.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (delta.type === "text_delta") {
        yield delta.text as string;
      } else if (delta.type === "input_json_delta") {
        // Accumulate partial JSON for tool arguments
        const idx = e.index as number;
        const acc = toolCallAcc.get(idx);
        if (acc) {
          acc.arguments += (delta.partial_json ?? "") as string;
        }
      }
    } else if (eventType === "content_block_start") {
      const block = e.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        const idx = e.index as number;
        toolCallAcc.set(idx, {
          id: (block.id ?? "") as string,
          name: (block.name ?? "") as string,
          arguments: "",
        });
      }
    }
  }

  // Yield accumulated tool calls at the end of the stream
  const sortedIndices = [...toolCallAcc.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const tc = toolCallAcc.get(idx)!;
    yield { id: tc.id, name: tc.name, arguments: tc.arguments } as ToolCall;
  }
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
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}
