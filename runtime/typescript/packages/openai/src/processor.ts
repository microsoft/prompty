/**
 * OpenAI processor — extracts clean results from raw OpenAI responses.
 *
 * Handles ChatCompletion, Embedding, and Image responses.
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
      emit("result", result);
      return result;
    });
  }
}

/**
 * Extract clean content from an OpenAI response.
 */
export function processResponse(agent: Prompty, response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;

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
    if (data.length > 0 && "url" in data[0]) {
      return processImage(r);
    }
  }

  return response;
}

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
