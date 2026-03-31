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
import { traceSpan } from "@prompty/core";

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
}

/**
 * Extract clean content from an OpenAI response.
 */
export function processResponse(agent: Prompty, response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;

  // Streaming response — return content-extracting async generator
  if (isAsyncIterable(response)) {
    return streamGenerator(response);
  }

  const r = response as Record<string, unknown>;

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
async function* streamGenerator(
  response: AsyncIterable<unknown>,
): AsyncGenerator<string | ToolCall> {
  const toolCallAcc: Map<number, { id: string; name: string; arguments: string }> = new Map();

  for await (const chunk of response) {
    const c = chunk as Record<string, unknown>;
    const choices = c.choices as Record<string, unknown>[] | undefined;
    if (!choices || choices.length === 0) continue;

    const delta = (choices[0] as Record<string, unknown>).delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    // Content
    if (delta.content != null) {
      yield delta.content as string;
    }

    // Tool call deltas — accumulate index-keyed partial chunks
    const tcDeltas = delta.tool_calls as Record<string, unknown>[] | undefined;
    if (tcDeltas) {
      for (const tcDelta of tcDeltas) {
        const idx = tcDelta.index as number;
        if (!toolCallAcc.has(idx)) {
          toolCallAcc.set(idx, { id: "", name: "", arguments: "" });
        }
        const acc = toolCallAcc.get(idx)!;
        if (tcDelta.id) acc.id = tcDelta.id as string;
        const fn = tcDelta.function as Record<string, unknown> | undefined;
        if (fn) {
          if (fn.name) acc.name = fn.name as string;
          if (fn.arguments) acc.arguments += fn.arguments as string;
        }
      }
    }

    // Refusal
    if (delta.refusal != null) {
      throw new Error(`Model refused: ${delta.refusal}`);
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
  if (content === null) return null;

  // Structured output — JSON parse when outputs schema exists
  if (agent.outputs && agent.outputs.length > 0) {
    try {
      return JSON.parse(content);
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
