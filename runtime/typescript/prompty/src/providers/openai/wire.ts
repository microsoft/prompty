/**
 * Wire format conversion: Message → OpenAI API JSON.
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { ContentPart, Message } from "../../core/types.js";

/**
 * Convert an abstract Message to OpenAI wire format.
 */
export function messageToWire(msg: Message): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: msg.role };

  // Include metadata fields (e.g., name, tool_call_id, tool_calls)
  for (const [k, v] of Object.entries(msg.metadata)) {
    if (k !== "role" && k !== "content") {
      wire[k] = v;
    }
  }

  const content = msg.toTextContent();
  if (typeof content === "string") {
    wire.content = content;
  } else {
    // Multimodal — convert parts to OpenAI format
    wire.content = msg.parts.map(partToWire);
  }

  return wire;
}

/**
 * Convert a ContentPart to OpenAI wire format.
 */
function partToWire(part: ContentPart): Record<string, unknown> {
  switch (part.kind) {
    case "text":
      return { type: "text", text: part.value };
    case "image": {
      const imageUrl: Record<string, unknown> = { url: part.source };
      if (part.detail) imageUrl.detail = part.detail;
      return { type: "image_url", image_url: imageUrl };
    }
    case "audio":
      return {
        type: "input_audio",
        input_audio: {
          data: part.source,
          ...(part.mediaType && { format: part.mediaType }),
        },
      };
    case "file":
      return { type: "file", file: { url: part.source } };
  }
}

/**
 * Build chat completion arguments from agent config and messages.
 */
export function buildChatArgs(
  agent: PromptAgent,
  messages: Message[],
): Record<string, unknown> {
  const model = agent.model?.id ?? "gpt-4";
  const wireMessages = messages.map(messageToWire);

  const args: Record<string, unknown> = {
    model,
    messages: wireMessages,
    ...buildOptions(agent),
  };

  // Tools
  const tools = toolsToWire(agent);
  if (tools.length > 0) {
    args.tools = tools;
  }

  // Structured output
  const responseFormat = outputSchemaToWire(agent);
  if (responseFormat) {
    args.response_format = responseFormat;
  }

  return args;
}

/**
 * Build embedding arguments.
 */
export function buildEmbeddingArgs(
  agent: PromptAgent,
  data: unknown,
): Record<string, unknown> {
  const model = agent.model?.id ?? "text-embedding-ada-002";
  return {
    input: Array.isArray(data) ? data : [data],
    model,
  };
}

/**
 * Build image generation arguments.
 */
export function buildImageArgs(
  agent: PromptAgent,
  data: unknown,
): Record<string, unknown> {
  const model = agent.model?.id ?? "dall-e-3";
  return {
    prompt: typeof data === "string" ? data : String(data),
    model,
    ...buildOptions(agent),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOptions(agent: PromptAgent): Record<string, unknown> {
  const opts = agent.model?.options;
  if (!opts) return {};

  const result: Record<string, unknown> = {};

  if (opts.temperature !== undefined) result.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) result.max_tokens = opts.maxOutputTokens;
  if (opts.topP !== undefined) result.top_p = opts.topP;
  if (opts.frequencyPenalty !== undefined) result.frequency_penalty = opts.frequencyPenalty;
  if (opts.presencePenalty !== undefined) result.presence_penalty = opts.presencePenalty;
  if ((opts as unknown as Record<string, unknown>).stop !== undefined) result.stop = (opts as unknown as Record<string, unknown>).stop;
  if (opts.seed !== undefined) result.seed = opts.seed;

  // Pass through additionalProperties
  if (opts.additionalProperties) {
    for (const [k, v] of Object.entries(opts.additionalProperties)) {
      result[k] = v;
    }
  }

  return result;
}

function toolsToWire(agent: PromptAgent): Record<string, unknown>[] {
  const tools = agent.tools;
  if (!tools || tools.length === 0) return [];

  return tools
    .filter((t) => (t as unknown as Record<string, unknown>).type === "function" || t.constructor?.name === "FunctionTool")
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: (t as { save?: () => Record<string, unknown> }).save?.() ?? {},
      },
    }));
}

function outputSchemaToWire(agent: PromptAgent): Record<string, unknown> | null {
  const schema = agent.outputSchema;
  if (!schema?.properties || schema.properties.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of schema.properties) {
    if (!prop.name) continue;
    properties[prop.name] = {
      type: prop.kind ?? "string",
      ...(prop.description && { description: prop.description }),
    };
    if (prop.required) required.push(prop.name);
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "response",
      strict: true,
      schema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}
