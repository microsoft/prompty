/**
 * Wire format conversion: Message → OpenAI API JSON.
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { ContentPart, Message } from "@prompty/core";

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
  agent: Prompty,
  messages: Message[],
): Record<string, unknown> {
  const model = agent.model?.id || "gpt-4";
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
 * Only additionalProperties are passed — chat options are not valid here.
 */
export function buildEmbeddingArgs(
  agent: Prompty,
  data: unknown,
): Record<string, unknown> {
  const model = agent.model?.id || "text-embedding-ada-002";

  // Extract text content from Message objects if needed
  let input: unknown;
  if (Array.isArray(data)) {
    const texts = data.map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) return (item as { text: string }).text;
      if (item && typeof item === "object" && "toTextContent" in item) {
        const content = (item as { toTextContent: () => unknown }).toTextContent();
        return typeof content === "string" ? content : String(content);
      }
      return String(item);
    });
    input = texts;
  } else if (typeof data === "string") {
    input = [data];
  } else {
    input = [String(data)];
  }

  const args: Record<string, unknown> = { input, model };
  const extra = agent.model?.options?.additionalProperties;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      args[k] = v;
    }
  }
  return args;
}

/**
 * Build image generation arguments.
 * Only additionalProperties are passed — chat options are not valid here.
 */
export function buildImageArgs(
  agent: Prompty,
  data: unknown,
): Record<string, unknown> {
  const model = agent.model?.id || "dall-e-3";

  // Extract prompt text: data may be a string, or a Message[] from the parser
  let prompt: string;
  if (typeof data === "string") {
    prompt = data;
  } else if (Array.isArray(data)) {
    // Messages have .parts[].value for text content, or a .text getter
    prompt = data
      .map((m: { text?: string; parts?: { kind: string; value: string }[] }) => {
        if (typeof m.text === "string") return m.text;
        if (Array.isArray(m.parts)) {
          return m.parts
            .filter((p) => p.kind === "text")
            .map((p) => p.value)
            .join("");
        }
        return String(m);
      })
      .join("\n")
      .trim();
  } else {
    prompt = String(data);
  }

  const args: Record<string, unknown> = { prompt, model };
  const extra = agent.model?.options?.additionalProperties;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      args[k] = v;
    }
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
  if (opts.maxOutputTokens !== undefined) result.max_completion_tokens = opts.maxOutputTokens;
  if (opts.topP !== undefined) result.top_p = opts.topP;
  if (opts.frequencyPenalty !== undefined) result.frequency_penalty = opts.frequencyPenalty;
  if (opts.presencePenalty !== undefined) result.presence_penalty = opts.presencePenalty;
  if (opts.stopSequences !== undefined && opts.stopSequences.length > 0) result.stop = opts.stopSequences;
  if (opts.seed !== undefined) result.seed = opts.seed;

  // Pass through additionalProperties — but don't overwrite mapped keys
  if (opts.additionalProperties) {
    for (const [k, v] of Object.entries(opts.additionalProperties)) {
      if (!(k in result)) {
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

  for (const p of properties as Array<{ name?: string; kind?: string; description?: string; required?: boolean; enumValues?: unknown[] }>) {
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

/** Convert a single Property to a JSON Schema definition (recursive for structured output). */
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

  // Array items
  if (prop.kind === "array") {
    schema.items = prop.items
      ? propertyToJsonSchema(prop.items as typeof prop)
      : { type: "string" };
  }

  // Nested object
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

function toolsToWire(agent: Prompty): Record<string, unknown>[] {
  const tools = agent.tools;
  if (!tools || tools.length === 0) return [];

  const result: Record<string, unknown>[] = [];

  for (const t of tools) {
    if (t.kind !== "function") continue;

    const funcDef: Record<string, unknown> = { name: t.name };
    if (t.description) funcDef.description = t.description;

    // Serialize parameters via schemaToWire
    const params = (t as { parameters?: unknown[] }).parameters;
    if (params && Array.isArray(params)) {
      funcDef.parameters = schemaToWire(params);
    }

    // Strict mode
    const strict = (t as { strict?: boolean }).strict;
    if (strict) {
      funcDef.strict = true;
      if (funcDef.parameters) {
        (funcDef.parameters as Record<string, unknown>).additionalProperties = false;
      }
    }

    result.push({ type: "function", function: funcDef });
  }

  return result;
}

function outputSchemaToWire(agent: Prompty): Record<string, unknown> | null {
  const outputs = agent.outputs;
  if (!outputs || outputs.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of outputs) {
    if (!prop.name) continue;
    properties[prop.name] = propertyToJsonSchema(prop as Parameters<typeof propertyToJsonSchema>[0]);
    required.push(prop.name);
  }

  const name = (agent.name || "response").toLowerCase().replace(/[\s-]/g, "_");

  return {
    type: "json_schema",
    json_schema: {
      name,
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

// ---------------------------------------------------------------------------
// Responses API wire format
// ---------------------------------------------------------------------------

/**
 * Build Responses API arguments from agent config and messages.
 *
 * Key differences from Chat Completions:
 * - System messages → `instructions` parameter
 * - Other messages → `input` as EasyInputMessage[]
 * - `maxOutputTokens` → `max_output_tokens`
 * - Structured output → `text.format` (not `response_format`)
 * - Tools use flat `{ type: "function", name, parameters }` (not nested `function:`)
 */
export function buildResponsesArgs(
  agent: Prompty,
  messages: Message[],
): Record<string, unknown> {
  const model = agent.model?.id || "gpt-4o";

  // Separate system messages as instructions, rest as input
  const systemParts: string[] = [];
  const inputMessages: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemParts.push(msg.text);
    } else {
      inputMessages.push(messageToResponsesInput(msg));
    }
  }

  const args: Record<string, unknown> = {
    model,
    input: inputMessages,
  };

  // Set instructions from system messages
  if (systemParts.length > 0) {
    args.instructions = systemParts.join("\n\n");
  }

  // Map model options
  const responseOpts = buildResponsesOptions(agent);
  Object.assign(args, responseOpts);

  // Tools
  const tools = responsesToolsToWire(agent);
  if (tools.length > 0) {
    args.tools = tools;
  }

  // Structured output via text.format
  const textConfig = outputSchemaToResponsesWire(agent);
  if (textConfig) {
    args.text = textConfig;
  }

  return args;
}

/** Convert a Message to Responses API EasyInputMessage format. */
function messageToResponsesInput(msg: Message): Record<string, unknown> {
  const content = msg.toTextContent();

  // Pass-through original function_call items from the agent loop
  if (msg.metadata.responses_function_call) {
    return msg.metadata.responses_function_call as Record<string, unknown>;
  }

  // Tool result messages → function_call_output
  if (msg.metadata.tool_call_id) {
    return {
      type: "function_call_output",
      call_id: msg.metadata.tool_call_id,
      output: typeof content === "string" ? content : JSON.stringify(content),
    };
  }

  const role = msg.role === "tool" ? "user" : msg.role;
  return { role, content };
}

/** Build Responses-specific model options. */
function buildResponsesOptions(agent: Prompty): Record<string, unknown> {
  const opts = agent.model?.options;
  if (!opts) return {};

  const result: Record<string, unknown> = {};

  if (opts.temperature !== undefined) result.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) result.max_output_tokens = opts.maxOutputTokens;
  if (opts.topP !== undefined) result.top_p = opts.topP;

  // Pass through additionalProperties — but don't overwrite mapped keys
  if (opts.additionalProperties) {
    for (const [k, v] of Object.entries(opts.additionalProperties)) {
      if (!(k in result)) {
        result[k] = v;
      }
    }
  }

  return result;
}

/** Convert agent tools to Responses API tool format. */
function responsesToolsToWire(agent: Prompty): Record<string, unknown>[] {
  const tools = agent.tools;
  if (!tools || tools.length === 0) return [];

  const result: Record<string, unknown>[] = [];

  for (const t of tools) {
    if (t.kind !== "function") continue;

    // Responses API uses flat tool format (not nested under "function:")
    const tool: Record<string, unknown> = {
      type: "function",
      name: t.name,
    };
    if (t.description) tool.description = t.description;

    const params = (t as { parameters?: unknown[] }).parameters;
    if (params && Array.isArray(params)) {
      tool.parameters = schemaToWire(params);
    }

    const strict = (t as { strict?: boolean }).strict;
    if (strict) {
      tool.strict = true;
      if (tool.parameters) {
        (tool.parameters as Record<string, unknown>).additionalProperties = false;
      }
    }

    result.push(tool);
  }

  return result;
}

/** Convert outputSchema to Responses API text.format config. */
function outputSchemaToResponsesWire(agent: Prompty): Record<string, unknown> | null {
  const outputs = agent.outputs;
  if (!outputs || outputs.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of outputs) {
    if (!prop.name) continue;
    properties[prop.name] = propertyToJsonSchema(prop as Parameters<typeof propertyToJsonSchema>[0]);
    required.push(prop.name);
  }

  const name = (agent.name || "response").toLowerCase().replace(/[\s-]/g, "_");

  return {
    format: {
      type: "json_schema",
      name,
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
