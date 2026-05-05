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

  // Always use content blocks array for Anthropic wire format
  wire.content = msg.parts.map(partToWire);

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
      if (part.mediaType) {
        // mediaType present → treat source as base64 data
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: part.mediaType,
            data: part.source,
          },
        };
      }
      if (part.source.startsWith("data:")) {
        // Data URL — extract base64 payload and MIME type
        const [header, data] = part.source.split(",", 2);
        // Extract MIME type between "data:" and ";" without regex backtracking
        const mimeStart = header?.indexOf("data:") === 0 ? 5 : 0;
        const mimeEnd = header?.indexOf(";", mimeStart) ?? -1;
        const mediaType = mimeEnd > mimeStart ? header!.slice(mimeStart, mimeEnd) : "image/png";
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

const DEFAULT_MAX_TOKENS = 4096;

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

  const opts = buildOptions(agent);

  const args: Record<string, unknown> = {
    model,
    messages: conversationMessages,
    ...opts,
  };

  // Anthropic requires max_tokens — use default if toWire didn't emit it
  if (!("max_tokens" in args)) {
    args.max_tokens = DEFAULT_MAX_TOKENS;
  }

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
  const outputConfig = outputsToWire(agent);
  if (outputConfig) {
    args.output_config = outputConfig;
  }

  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map Prompty kind strings to JSON Schema type strings. */
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

  const result = modelOptionsToWire(opts as unknown as Record<string, unknown>);

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

function modelOptionsToWire(
  opts: Record<string, unknown> & { toWire?: (provider: string) => Record<string, unknown> },
): Record<string, unknown> {
  const result = typeof opts.toWire === "function" ? opts.toWire("anthropic") : {};

  const mappings: Record<string, string> = {
    maxOutputTokens: "max_tokens",
    temperature: "temperature",
    topK: "top_k",
    topP: "top_p",
    stopSequences: "stop_sequences",
  };

  for (const [key, target] of Object.entries(mappings)) {
    const value = opts[key];
    if (value === undefined || value === null) continue;
    if (key === "stopSequences" && Array.isArray(value) && value.length === 0) continue;
    result[target] = value;
  }

  if (Array.isArray(opts.stopSequences) && opts.stopSequences.length === 0) {
    delete result.stop_sequences;
  }

  return result;
}

/** Convert a Property list to a JSON Schema `{type: "object", properties: ...}`. */
function schemaToWire(properties: unknown[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of properties as Array<{ name?: string; required?: boolean } & Parameters<typeof propertyToJsonSchema>[0]>) {
    if (!p.name) continue;
    props[p.name] = propertyToJsonSchema(p);
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

    // Collect bound parameter names to strip from wire format
    const boundNames = new Set((t.bindings ?? []).map((b) => b.name));

    let params = (t as { parameters?: unknown[] }).parameters;
    if (params && Array.isArray(params)) {
      if (boundNames.size > 0) {
        params = params.filter((p) => !boundNames.has((p as Record<string, unknown>).name as string));
      }
      tool.input_schema = schemaToWire(params);
    } else {
      tool.input_schema = { type: "object", properties: {} };
    }

    result.push(tool);
  }

  return result;
}

/**
 * Convert outputs to Anthropic structured output config.
 *
 * Anthropic uses: output_config: { format: { type: "json_schema", schema: {...} } }
 */
export function outputsToWire(agent: Prompty): Record<string, unknown> | null {
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
