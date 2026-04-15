/**
 * Core message types for the Prompty pipeline.
 *
 * Re-exports generated model types and provides standalone utility
 * functions that operate on them. No prototype mutation — the emitted
 * types are used as-is.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Re-export generated model types
// ---------------------------------------------------------------------------

export { ContentPart, TextPart, ImagePart, FilePart, AudioPart } from "../model/content-part.js";
export { Message } from "../model/message.js";
export { ToolResult } from "../model/tool-result.js";

import { ContentPart, TextPart, ImagePart, FilePart, AudioPart } from "../model/content-part.js";
import { Message } from "../model/message.js";
import { ToolResult } from "../model/tool-result.js";

// ---------------------------------------------------------------------------
// Message utilities (standalone functions, no augmentation)
// ---------------------------------------------------------------------------

/** Concatenate all TextPart values from a Message into a single string. */
export function messageText(msg: Message): string {
  return msg.parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.value)
    .join("");
}

/**
 * Return Message content in a format suitable for wire serialization:
 * - If all parts are text, return a single string.
 * - If multimodal, return an array of content objects.
 */
export function messageToTextContent(msg: Message): string | Record<string, unknown>[] {
  if (msg.parts.length === 1 && msg.parts[0].kind === "text") {
    return (msg.parts[0] as TextPart).value;
  }
  return msg.parts.map(partToWireContent);
}

/** Convert a ContentPart to a generic wire-format object. */
function partToWireContent(part: ContentPart): Record<string, unknown> {
  switch (part.kind) {
    case "text":
      return { type: "text", text: (part as TextPart).value };
    case "image": {
      const img = part as ImagePart;
      return {
        type: "image_url",
        image_url: { url: img.source, ...(img.detail && { detail: img.detail }) },
      };
    }
    case "file":
      return { type: "file", file: { url: (part as FilePart).source } };
    case "audio": {
      const audio = part as AudioPart;
      return {
        type: "input_audio",
        input_audio: {
          data: audio.source,
          ...(audio.mediaType && { format: audio.mediaType }),
        },
      };
    }
    default:
      return { type: "text", text: String(part) };
  }
}

// ---------------------------------------------------------------------------
// ToolResult utilities (standalone functions, no augmentation)
// ---------------------------------------------------------------------------

/** Concatenate all TextPart values from a ToolResult into a single string. */
export function toolResultText(result: ToolResult): string {
  return (result.parts ?? [])
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.value)
    .join("");
}

/** Create a ToolResult containing a single TextPart. */
export function textToolResult(value: string): ToolResult {
  return new ToolResult({ parts: [new TextPart({ value })] });
}

// ---------------------------------------------------------------------------
// Role type
// ---------------------------------------------------------------------------

/** Valid message roles. */
export type Role = "system" | "user" | "assistant" | "developer" | "tool";

// ---------------------------------------------------------------------------
// Thread Marker
// ---------------------------------------------------------------------------

/**
 * Positional marker for conversation history insertion.
 *
 * During `prepare()`, nonce strings in rendered text are replaced
 * with ThreadMarker objects. Then `expandThreadMarkers()` replaces
 * them with actual conversation messages from the inputs.
 */
export class ThreadMarker {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

// ---------------------------------------------------------------------------
// ToolCall (re-exported from generated model)
// ---------------------------------------------------------------------------

export { ToolCall } from "../model/tool-call.js";

// ---------------------------------------------------------------------------
// Rich Input Kinds
// ---------------------------------------------------------------------------

/**
 * Input kinds that receive special handling in the pipeline
 * (nonce-based substitution rather than direct template interpolation).
 */
export const RICH_KINDS = new Set(["thread", "image", "file", "audio"]);

/** Standard message roles. */
export const ROLES = new Set<Role>(["system", "user", "assistant", "developer", "tool"]);

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Tracing-aware wrapper for asynchronous LLM streaming responses.
 *
 * Accumulates all chunks as they are yielded. When the async iterator
 * is exhausted, the accumulated items are flushed to the tracer.
 */
export class PromptyStream implements AsyncIterable<unknown> {
  readonly name: string;
  private readonly inner: AsyncIterable<unknown>;
  readonly items: unknown[] = [];

  constructor(name: string, inner: AsyncIterable<unknown>) {
    this.name = name;
    this.inner = inner;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    const { Tracer } = await import("../tracing/tracer.js");
    try {
      for await (const chunk of this.inner) {
        this.items.push(chunk);
        yield chunk;
      }
    } finally {
      if (this.items.length > 0) {
        const span = Tracer.start("PromptyStream");
        span("signature", `${this.name}.PromptyStream`);
        span("inputs", "None");
        span("result", this.items);
        span.end();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a TextPart. */
export function text(value: string): TextPart {
  return new TextPart({ value });
}

/** Create a Message with a single text part. */
export function textMessage(role: Role, value: string, metadata: Record<string, unknown> = {}): Message {
  return new Message({ role, parts: [text(value)], metadata });
}

/** Convert a plain dict `{role, content, ...}` to a Message. */
export function dictToMessage(d: Record<string, unknown>): Message {
  const role = (d.role as string) ?? "user";
  const metadata: Record<string, unknown> = {};
  const parts: ContentPart[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (k !== "role" && k !== "content") {
      metadata[k] = v;
    }
  }
  const content = d.content;
  if (typeof content === "string") {
    parts.push(text(content));
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(text(item));
      } else if (typeof item === "object" && item !== null) {
        parts.push(dictContentToPart(item as Record<string, unknown>));
      }
    }
  }
  return new Message({ role, parts, metadata });
}

/** Convert a content dict to a ContentPart. */
export function dictContentToPart(d: Record<string, unknown>): ContentPart {
  const type = (d.type as string) ?? (d.kind as string) ?? "text";
  switch (type) {
    case "text":
      return new TextPart({ value: (d.text ?? d.value ?? "") as string });
    case "image_url":
    case "image": {
      const img = (d.image_url ?? d) as Record<string, unknown>;
      return new ImagePart({
        source: (img.url ?? img.source ?? "") as string,
        detail: img.detail as string | undefined,
        mediaType: img.media_type as string | undefined,
      });
    }
    case "file":
      return new FilePart({
        source: (d.url ?? d.source ?? "") as string,
        mediaType: d.media_type as string | undefined,
      });
    case "input_audio":
    case "audio": {
      const audio = (d.input_audio ?? d) as Record<string, unknown>;
      return new AudioPart({
        source: (audio.data ?? audio.source ?? "") as string,
        mediaType: (audio.format ?? audio.media_type) as string | undefined,
      });
    }
    default:
      return new TextPart({ value: JSON.stringify(d) });
  }
}