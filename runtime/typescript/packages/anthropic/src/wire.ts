/**
 * Wire format conversion: Message → Anthropic Messages API JSON.
 *
 * Key differences from OpenAI:
 * - `system` is a separate top-level parameter (not in messages)
 * - Tools use `input_schema` (not nested `{type: "function", function: {...}}`)
 * - `max_tokens` is required
 * - Structured output uses `output_config.format` with `json_schema`
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { ContentPart, Message } from "@prompty/core";

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

/**
 * Convert an abstract Message to Anthropic wire format.
 * System messages are excluded — they go in a separate `system` parameter.
 */
export function messageToWire(msg: Message): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: msg.role };

  // Batched tool results → single user message with all tool_result blocks
  if (msg.metadata.tool_results && Array.isArray(msg.metadata.tool_results)) {
    wire.role = "user";
    wire.content = msg.metadata.tool_results;
    return wire;
  }

  // Legacy single tool result messages (backward compat)
  if (msg.metadata.tool_use_id || msg.metadata.tool_call_id) {
    const toolUseId = (msg.metadata.tool_use_id ?? msg.metadata.tool_call_id) as string;
    wire.role = "user";
    wire.content = [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: msg.toTextContent(),
      },
    ];
    return wire;
  }

  // Assistant messages with raw content blocks (tool_use) — preserve them
  if (msg.role === "assistant" && msg.metadata.content && Array.isArray(msg.metadata.content)) {
    wire.content = msg.metadata.content;
    return wire;
  }

  const content = msg.toTextContent();
  if (typeof content === "string") {
    wire.content = content;
  } else {
    // Multimodal — convert parts to Anthropic format
    wire.content = msg.parts.map(partToWire);
  }

  return wire;
}

/**
 * Convert a ContentPart to Anthropic wire format.
 */
function partToWire(part: ContentPart): Record<string, unknown> {
  switch (part.kind) {
    case "text":
      return { type: "text", text: part.value };
    case "image": {
      // Anthropic uses base64 source blocks or URL
      if (part.source.startsWith("data:") || part.source.startsWith("/")) {
        // Base64 encoded
        const [header, data] = part.source.split(",", 2);
        const mediaType = header?.match(/data:(.*?);/)?.[1] ?? "image/png";
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: data ?? part.source,
          },
        };
      }
      // URL
      return {
        type: "image",
        source: { type: "url", url: part.source },
      };
    }
    case "file":
      return { type: "text", text: `[file: ${part.source}]` };
    case "audio":
      return { type: "text", text: `[audio: ${part.source}]` };
  }
}

// ---------------------------------------------------------------------------
// Build API arguments
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 1024;

/**
 * Build Anthropic Messages API arguments from agent config and messages.
 */
export function buildChatArgs(
  agent: Prompty,
  messages: Message[],
): Record<string, unknown> {
  const model = agent.model?.id || "claude-sonnet-4-5-20250929";

  // Separate system messages from conversation messages
  const systemParts: string[] = [];
  const conversationMessages: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.text);
    } else {
      conversationMessages.push(messageToWire(msg));
    }
  }

  const args: Record<string, unknown> = {
    model,
    messages: conversationMessages,
    max_tokens: agent.model?.options?.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    ...buildOptions(agent),
  };

  // System prompt as separate parameter
  if (systemParts.length > 0) {
    args.system = systemParts.join("\n\n");
  }

  // Tools
  const tools = toolsToWire(agent);
  if (tools.length > 0) {
    args.tools = tools;
  }

  // Structured output
  const outputConfig = outputSchemaToWire(agent);
  if (outputConfig) {
    args.output_config = outputConfig;
  }

  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map AgentSchema kind strings to JSON Schema type strings. */
const KIND_TO_JSON_TYPE: Record<string, string> = {
  string: "string",
  integer: "integer",
  float: "number",
  number: "number",
  boolean: "boolean",
  array: "array",
  object: "object",
};

function buildOptions(agent: Prompty): Record<string, unknown> {
  const opts = agent.model?.options;
  if (!opts) return {};

  const result: Record<string, unknown> = {};

  if (opts.temperature !== undefined) result.temperature = opts.temperature;
  if (opts.topP !== undefined) result.top_p = opts.topP;
  if (opts.topK !== undefined) result.top_k = opts.topK;
  if (opts.stopSequences !== undefined) result.stop_sequences = opts.stopSequences;

  // Pass through additionalProperties — but don't overwrite mapped keys
  if (opts.additionalProperties) {
    for (const [k, v] of Object.entries(opts.additionalProperties)) {
      if (!(k in result) && k !== "max_tokens") {
        result[k] = v;
      }
    }
  }

  return result;
}

/** Convert a Property list to a JSON Schema `{type: "object", properties: ...}`. */
function schemaToWire(properties: unknown[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of properties as Array<{
    name?: string;
    kind?: string;
    description?: string;
    required?: boolean;
    enumValues?: unknown[];
  }>) {
    if (!p.name) continue;
    const schema: Record<string, unknown> = {
      type: KIND_TO_JSON_TYPE[p.kind ?? "string"] ?? "string",
    };
    if (p.description) schema.description = p.description;
    if (p.enumValues && p.enumValues.length > 0) schema.enum = p.enumValues;
    props[p.name] = schema;
    if (p.required) required.push(p.name);
  }

  const result: Record<string, unknown> = { type: "object", properties: props };
  if (required.length > 0) result.required = required;
  return result;
}

/** Convert a single Property to a JSON Schema definition. */
function propertyToJsonSchema(prop: {
  kind?: string;
  description?: string;
  enumValues?: unknown[];
  items?: unknown;
  properties?: unknown[];
}): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: KIND_TO_JSON_TYPE[prop.kind ?? "string"] ?? "string",
  };

  if (prop.description) schema.description = prop.description;
  if (prop.enumValues && prop.enumValues.length > 0) schema.enum = prop.enumValues;

  if (prop.kind === "array") {
    schema.items = prop.items
      ? propertyToJsonSchema(prop.items as typeof prop)
      : { type: "string" };
  }

  if (prop.kind === "object") {
    if (prop.properties) {
      const nested: Record<string, unknown> = {};
      const req: string[] = [];
      for (const p of prop.properties as Array<{ name?: string } & typeof prop>) {
        if (!p.name) continue;
        nested[p.name] = propertyToJsonSchema(p);
        req.push(p.name);
      }
      schema.properties = nested;
      schema.required = req;
    } else {
      schema.properties = {};
      schema.required = [];
    }
    schema.additionalProperties = false;
  }

  return schema;
}

/**
 * Convert agent tools to Anthropic tool format.
 *
 * Anthropic uses: { name, description, input_schema }
 * (no `{type: "function", function: {...}}` wrapper like OpenAI)
 */
export function toolsToWire(agent: Prompty): Record<string, unknown>[] {
  const tools = agent.tools;
  if (!tools || tools.length === 0) return [];

  const result: Record<string, unknown>[] = [];

  for (const t of tools) {
    if (t.kind !== "function") continue;

    const tool: Record<string, unknown> = { name: t.name };
    if (t.description) tool.description = t.description;

    const params = (t as { parameters?: unknown[] }).parameters;
    if (params && Array.isArray(params)) {
      tool.input_schema = schemaToWire(params);
    } else {
      tool.input_schema = { type: "object", properties: {} };
    }

    result.push(tool);
  }

  return result;
}

/**
 * Convert outputSchema to Anthropic structured output config.
 *
 * Anthropic uses: output_config: { format: { type: "json_schema", schema: {...} } }
 */
export function outputSchemaToWire(agent: Prompty): Record<string, unknown> | null {
  const outputs = agent.outputs;
  if (!outputs || outputs.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of outputs) {
    if (!prop.name) continue;
    properties[prop.name] = propertyToJsonSchema(
      prop as Parameters<typeof propertyToJsonSchema>[0],
    );
    required.push(prop.name);
  }

  return {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}
