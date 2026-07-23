/**
 * Wire format conversion: Message → OpenAI API JSON.
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { ContentPart, Message } from "@prompty/core";
import { load as loadPrompty } from "@prompty/core";
import { dirname, resolve } from "node:path";

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
          ...(part.mediaType && { format: mimeToAudioFormat(part.mediaType) }),
        },
      };
    case "file":
      return { type: "file", file: { url: part.source } };
  }
}

/** Map audio MIME types to OpenAI short format names. */
const AUDIO_MIME_MAP: Record<string, string> = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "audio/pcm": "pcm",
};

function mimeToAudioFormat(mediaType: string): string {
  return AUDIO_MIME_MAP[mediaType.toLowerCase()] ?? mediaType;
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
  const responseFormat = outputsToWire(agent);
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
    // Single input → string, multiple → array
    input = texts.length === 1 ? texts[0] : texts;
  } else if (typeof data === "string") {
    input = data;
  } else {
    input = String(data);
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

  const result = modelOptionsToWire(opts as unknown as Record<string, unknown>, "openai");

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

function modelOptionsToWire(
  opts: Record<string, unknown> & { toWire?: (provider: string) => Record<string, unknown> },
  provider: "openai" | "responses",
): Record<string, unknown> {
  const result = typeof opts.toWire === "function" ? opts.toWire(provider) : {};

  const mappings: Record<string, Partial<Record<typeof provider, string>>> = {
    frequencyPenalty: { openai: "frequency_penalty" },
    maxOutputTokens: { openai: "max_completion_tokens", responses: "max_output_tokens" },
    presencePenalty: { openai: "presence_penalty" },
    seed: { openai: "seed" },
    temperature: { openai: "temperature", responses: "temperature" },
    topK: { openai: "top_k" },
    topP: { openai: "top_p", responses: "top_p" },
    stopSequences: { openai: "stop" },
    allowMultipleToolCalls: { openai: "parallel_tool_calls" },
  };

  for (const [key, mapping] of Object.entries(mappings)) {
    const target = mapping[provider];
    const value = opts[key];
    if (!target || value === undefined || value === null) continue;
    if (key === "stopSequences" && Array.isArray(value) && value.length === 0) continue;
    result[target] = value;
  }

  if (Array.isArray(opts.stopSequences) && opts.stopSequences.length === 0) {
    delete result.stop;
  }

  return result;
}

/** Convert a Property list to a JSON Schema `{type: "object", properties: ...}`. */
function schemaToWire(properties: unknown[], strict: boolean = false): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of properties as Array<{ name?: string; required?: boolean } & Parameters<typeof propertyToJsonSchema>[0]>) {
    if (!p.name) continue;
    props[p.name] = propertyToJsonSchema(p, strict && !p.required, strict);
    if (strict || p.required) required.push(p.name);
  }

  const result: Record<string, unknown> = { type: "object", properties: props };
  if (required.length > 0) result.required = required;
  return result;
}

/** Convert a single Property to a JSON Schema definition (recursive for structured output). */
function propertyToJsonSchema(prop: {
  kind?: string;
  required?: boolean;
  description?: string;
  enumValues?: unknown[];
  items?: unknown;
  properties?: unknown[];
  nullable?: boolean;
  oneOf?: unknown[];
  anyOf?: unknown[];
}, optional: boolean = false, strict: boolean = false): Record<string, unknown> {
  const jsonType = KIND_TO_JSON_TYPE[prop.kind ?? ""];
  const schema: Record<string, unknown> = jsonType ? { type: jsonType } : {};

  if (prop.description) schema.description = prop.description;
  if (prop.enumValues && prop.enumValues.length > 0) schema.enum = prop.enumValues;

  // Array items
  if (prop.kind === "array") {
    schema.items = prop.items
      ? propertyToJsonSchema(prop.items as typeof prop, false, strict)
      : { type: "string" };
  }

  // Nested object
  if (prop.kind === "object") {
    if (prop.properties) {
      const nested: Record<string, unknown> = {};
      const req: string[] = [];
      for (const p of prop.properties as Array<{ name?: string } & typeof prop>) {
        if (!p.name) continue;
          nested[p.name] = propertyToJsonSchema(p, strict && !p.required, strict);
          if (strict || p.required) req.push(p.name);
      }
      schema.properties = nested;
      if (req.length > 0) schema.required = req;
    } else {
      schema.properties = {};
    }
    schema.additionalProperties = false;
  }

  if (prop.kind === "union") {
    if (prop.oneOf?.length) {
      throw new Error(
        "OpenAI schemas do not support UnionProperty.oneOf; use the provider-supported anyOf composition",
      );
    }
    if (prop.anyOf?.length) {
      schema.anyOf = prop.anyOf.map((branch) =>
        propertyToJsonSchema(branch as typeof prop, false, strict),
      );
    }
  }

  if (prop.nullable || (strict && optional)) addNullability(schema);
  return schema;
}

function addNullability(schema: Record<string, unknown>): void {
  if (typeof schema.type === "string") {
    schema.type = [schema.type, "null"];
  } else if (Array.isArray(schema.anyOf)) {
    schema.anyOf.push({ type: "null" });
  } else if (Object.keys(schema).length > 0) {
    schema.anyOf = [{ ...schema }, { type: "null" }];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
    schema.enum.push(null);
  }
}

function toolsToWire(agent: Prompty): Record<string, unknown>[] {
  const tools = agent.tools;
  if (!tools || tools.length === 0) return [];

  const result: Record<string, unknown>[] = [];

  for (const t of tools) {
    if (t.kind === "function") {
      const funcDef: Record<string, unknown> = { name: t.name };
      if (t.description) funcDef.description = t.description;

      // Collect bound parameter names to strip from wire format
      const boundNames = new Set((t.bindings ?? []).map((b) => b.name));

      // Serialize parameters via schemaToWire, filtering out bound params
      let params = (t as { parameters?: unknown[] }).parameters;
      if (params && Array.isArray(params)) {
        if (boundNames.size > 0) {
          params = params.filter((p) => !boundNames.has((p as Record<string, unknown>).name as string));
        }
        funcDef.parameters = schemaToWire(params, Boolean((t as { strict?: boolean }).strict));
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
    } else if (t.kind === "prompty") {
      const funcDef = projectPromptyTool(t as unknown as Record<string, unknown>, agent);
      result.push({ type: "function", function: funcDef });
    }
  }

  return result;
}

/**
 * Project a PromptyTool as an OpenAI function definition.
 *
 * Loads the child `.prompty` file, uses its `inputs` as the
 * function parameters, and applies binding/strict stripping.
 */
function projectPromptyTool(tool: Record<string, unknown>, parent: Prompty): Record<string, unknown> {
  const toolPath = tool.path as string | undefined;
  if (!toolPath) {
    throw new Error(`PromptyTool '${tool.name}' has no path`);
  }

  // Resolve child path relative to the parent .prompty file
  const parentPath = (parent.metadata ?? {}).__source_path as string | undefined;
  if (!parentPath) {
    throw new Error(
      `Cannot resolve PromptyTool '${tool.name}': parent agent has no __source_path in metadata`,
    );
  }
  const childPath = resolve(dirname(parentPath), toolPath);
  const child = loadPrompty(childPath);

  const funcDef: Record<string, unknown> = { name: tool.name };
  funcDef.description = (tool.description as string) || child.description || "";

  // Use child's inputs as parameters, stripping bound params
  const bindings = (tool as { bindings?: { name: string }[] }).bindings;
  const boundNames = new Set((bindings ?? []).map((b) => b.name));

  const childInputs = child.inputs ?? [];
  let params: unknown[] = childInputs;
  if (boundNames.size > 0) {
    params = params.filter((p) => !boundNames.has((p as Record<string, unknown>).name as string));
  }
  funcDef.parameters = schemaToWire(params, Boolean((tool as { strict?: boolean }).strict));

  const strict = (tool as { strict?: boolean }).strict;
  if (strict) {
    funcDef.strict = true;
    if (funcDef.parameters) {
      (funcDef.parameters as Record<string, unknown>).additionalProperties = false;
    }
  }

  return funcDef;
}

function outputsToWire(agent: Prompty): Record<string, unknown> | null {
  const outputs = agent.outputs;
  if (!outputs || outputs.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of outputs) {
    if (!prop.name) continue;
    properties[prop.name] = propertyToJsonSchema(
      prop as Parameters<typeof propertyToJsonSchema>[0],
      !prop.required,
      true,
    );
    required.push(prop.name);
  }

  const name = "structured_output";

  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
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
  const textConfig = outputsToResponsesWire(agent);
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

  const result = modelOptionsToWire(opts as unknown as Record<string, unknown>, "responses");

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
    if (t.kind === "function") {
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
    } else if (t.kind === "prompty") {
      // Project prompty tool as a flat function definition (Responses API format)
      const projected = projectPromptyTool(t as unknown as Record<string, unknown>, agent);
      const tool: Record<string, unknown> = {
        type: "function",
        name: projected.name,
      };
      if (projected.description) tool.description = projected.description;
      if (projected.parameters) tool.parameters = projected.parameters;

      const strict = (projected as Record<string, unknown>).strict;
      if (strict) {
        tool.strict = true;
        if (tool.parameters) {
          (tool.parameters as Record<string, unknown>).additionalProperties = false;
        }
      }

      result.push(tool);
    }
  }

  return result;
}

/** Convert outputs to Responses API text.format config. */
function outputsToResponsesWire(agent: Prompty): Record<string, unknown> | null {
  const outputs = agent.outputs;
  if (!outputs || outputs.length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of outputs) {
    if (!prop.name) continue;
    properties[prop.name] = propertyToJsonSchema(
      prop as Parameters<typeof propertyToJsonSchema>[0],
      !prop.required,
    );
    required.push(prop.name);
  }

  const name = "structured_output";

  return {
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      },
    },
  };
}
