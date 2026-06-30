import "@typra/emitter";

namespace Prompty;

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
