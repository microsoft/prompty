import "agentschema-emitter";

namespace Prompty;

/**
 * The role of a message in a conversation.
 */
alias Role = "system" | "user" | "assistant" | "developer" | "tool";

/**
 * The kind discriminator for content parts.
 */
alias ContentPartType = "text" | "image" | "file" | "audio";

/**
 * A part of a message's content. Content parts are discriminated on the `kind`
 * field and represent the different modalities that can appear in a message.
 */
@abstract
@discriminator("kind")
model ContentPart {
  @doc("The kind of content part")
  kind: ContentPartType;
}

/**
 * A text content part.
 */
model TextPart extends ContentPart {
  @doc("The kind identifier for text content")
  kind: "text";

  @doc("The text content")
  @sample(#{ value: "Hello, world!" })
  value: string;
}

/**
 * An image content part. The source may be a URL or base64-encoded data.
 */
model ImagePart extends ContentPart {
  @doc("The kind identifier for image content")
  kind: "image";

  @doc("URL or base64-encoded image data")
  @sample(#{ source: "https://example.com/image.png" })
  source: string;

  @doc("Detail level hint for the model (e.g., 'auto', 'low', 'high')")
  @sample(#{ detail: "auto" })
  detail?: string;

  @doc("MIME type of the image (e.g., 'image/png')")
  @sample(#{ mediaType: "image/png" })
  mediaType?: string;
}

/**
 * A file content part. The source may be a URL or base64-encoded data.
 */
model FilePart extends ContentPart {
  @doc("The kind identifier for file content")
  kind: "file";

  @doc("URL or base64-encoded file data")
  @sample(#{ source: "https://example.com/document.pdf" })
  source: string;

  @doc("MIME type of the file (e.g., 'application/pdf')")
  @sample(#{ mediaType: "application/pdf" })
  mediaType?: string;
}

/**
 * An audio content part. The source may be a URL or base64-encoded data.
 */
model AudioPart extends ContentPart {
  @doc("The kind identifier for audio content")
  kind: "audio";

  @doc("URL or base64-encoded audio data")
  @sample(#{ source: "https://example.com/audio.wav" })
  source: string;

  @doc("MIME type of the audio (e.g., 'audio/wav')")
  @sample(#{ mediaType: "audio/wav" })
  mediaType?: string;
}

/**
 * A message in a conversation. Messages have a role and a list of content parts
 * representing the different modalities of the message content.
 */
@method("text", "string", "Concatenate all TextPart values joined by newline")
model Message {
  @doc("The role of the message sender")
  @sample(#{ role: "user" })
  role: Role = "user";

  @doc("The content parts of the message")
  @sample(#{ parts: #[#{ kind: "text", value: "Hello!" }] })
  parts: ContentPart[];

  @doc("Optional metadata associated with the message")
  @sample(#{ metadata: #{ source: "user-input" } })
  metadata?: Record<unknown>;
}

/**
 * A tool call requested by the LLM. Contains the function name and serialized
 * arguments that should be dispatched to the appropriate tool handler.
 */
model ToolCall {
  @doc("The unique identifier of the tool call")
  @sample(#{ id: "call_abc123" })
  id: string;

  @doc("The name of the tool to call")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The serialized JSON arguments for the tool call")
  @sample(#{ arguments: "{\"city\": \"Paris\"}" })
  arguments: string;
}

/**
 * The result of a tool execution. Contains a list of content parts, enabling
 * rich tool results (text, images, files, audio) rather than just strings.
 *
 * Implementations MUST support conversion from a plain string to a ToolResult
 * containing a single TextPart for backward compatibility.
 */
@method("text", "string", "Concatenate all TextPart values joined by newline")
model ToolResult {
  @doc("The content parts of the tool result")
  @sample(#{ parts: #[#{ kind: "text", value: "72°F and sunny" }] })
  parts: ContentPart[];
}
