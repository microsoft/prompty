/**
 * Core message types for the Prompty pipeline.
 *
 * These types are protocol-agnostic — they represent the abstract
 * message format that executors translate to provider-specific
 * wire formats (e.g., OpenAI JSON).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Content Parts (discriminated union by `kind`)
// ---------------------------------------------------------------------------

/** Base shape shared by all content parts. */
interface ContentPartBase {
  kind: string;
}

/** Plain text content. */
export interface TextPart extends ContentPartBase {
  kind: "text";
  value: string;
}

/** Image reference (URL or base64 data URI). */
export interface ImagePart extends ContentPartBase {
  kind: "image";
  source: string;
  detail?: string;
  mediaType?: string;
}

/** File reference. */
export interface FilePart extends ContentPartBase {
  kind: "file";
  source: string;
  mediaType?: string;
}

/** Audio reference (URL or base64 data URI). */
export interface AudioPart extends ContentPartBase {
  kind: "audio";
  source: string;
  mediaType?: string;
}

/** Discriminated union of all content part types. */
export type ContentPart = TextPart | ImagePart | FilePart | AudioPart;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/** Valid message roles. */
export type Role = "system" | "user" | "assistant" | "developer" | "tool";

/**
 * An abstract message in the Prompty pipeline.
 *
 * Executors convert this to provider-specific wire format.
 * Parsers produce this from rendered template text.
 */
export class Message {
  role: Role;
  parts: ContentPart[];
  metadata: Record<string, unknown>;

  constructor(
    role: Role,
    parts: ContentPart[] = [],
    metadata: Record<string, unknown> = {},
  ) {
    this.role = role;
    this.parts = parts;
    this.metadata = metadata;
  }

  /** Concatenate all TextPart values into a single string. */
  get text(): string {
    return this.parts
      .filter((p): p is TextPart => p.kind === "text")
      .map((p) => p.value)
      .join("");
  }

  /**
   * Return content in a format suitable for wire serialization:
   * - If all parts are text, return a single string.
   * - If multimodal, return an array of content objects.
   */
  toTextContent(): string | Record<string, unknown>[] {
    if (this.parts.length === 1 && this.parts[0].kind === "text") {
      return (this.parts[0] as TextPart).value;
    }
    return this.parts.map(partToWireContent);
  }
}

/** Convert a ContentPart to a generic wire-format object. */
function partToWireContent(part: ContentPart): Record<string, unknown> {
  switch (part.kind) {
    case "text":
      return { type: "text", text: part.value };
    case "image":
      return {
        type: "image_url",
        image_url: { url: part.source, ...(part.detail && { detail: part.detail }) },
      };
    case "file":
      return { type: "file", file: { url: part.source } };
    case "audio":
      return {
        type: "input_audio",
        input_audio: {
          data: part.source,
          ...(part.mediaType && { format: part.mediaType }),
        },
      };
  }
}

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
// ToolCall
// ---------------------------------------------------------------------------

/** Represents a tool call extracted from an LLM response. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

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
 *
 * Matches the Python PromptyStream / AsyncPromptyStream pattern.
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
    // Lazy import to avoid circular deps
    const { Tracer } = await import("../tracing/tracer.js");

    try {
      for await (const chunk of this.inner) {
        this.items.push(chunk);
        yield chunk;
      }
    } finally {
      // Flush accumulated items to tracer when stream is exhausted
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
  return { kind: "text", value };
}

/** Create a Message with a single text part. */
export function textMessage(role: Role, value: string, metadata: Record<string, unknown> = {}): Message {
  return new Message(role, [text(value)], metadata);
}

/** Convert a plain dict `{role, content, ...}` to a Message. */
export function dictToMessage(d: Record<string, unknown>): Message {
  const role = (d.role as Role) ?? "user";
  const metadata: Record<string, unknown> = {};
  const parts: ContentPart[] = [];

  // Copy non-role, non-content keys to metadata
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

  return new Message(role, parts, metadata);
}

/** Convert a content dict to a ContentPart. */
export function dictContentToPart(d: Record<string, unknown>): ContentPart {
  const type = (d.type as string) ?? (d.kind as string) ?? "text";
  switch (type) {
    case "text":
      return { kind: "text", value: (d.text ?? d.value ?? "") as string };
    case "image_url":
    case "image": {
      const img = (d.image_url ?? d) as Record<string, unknown>;
      return {
        kind: "image",
        source: (img.url ?? img.source ?? "") as string,
        detail: img.detail as string | undefined,
        mediaType: img.media_type as string | undefined,
      };
    }
    case "file":
      return {
        kind: "file",
        source: (d.url ?? d.source ?? "") as string,
        mediaType: d.media_type as string | undefined,
      };
    case "input_audio":
    case "audio": {
      const audio = (d.input_audio ?? d) as Record<string, unknown>;
      return {
        kind: "audio",
        source: (audio.data ?? audio.source ?? "") as string,
        mediaType: (audio.format ?? audio.media_type) as string | undefined,
      };
    }
    default:
      return { kind: "text", value: JSON.stringify(d) };
  }
}
