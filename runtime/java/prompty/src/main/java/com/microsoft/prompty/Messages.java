package com.microsoft.prompty;

import com.microsoft.prompty.model.AudioPart;
import com.microsoft.prompty.model.ContentPart;
import com.microsoft.prompty.model.FilePart;
import com.microsoft.prompty.model.ImagePart;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.TextPart;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Behaviour for the generated {@link Message} and {@link ContentPart} types.
 *
 * <p>The TypeSpec declares these helpers as methods, but the Java emitter has no seam for a
 * hand-written method body and emits stubs that throw. Rather than edit generated code — which
 * regeneration would discard — the behaviour lives here as static functions over the generated
 * types. The generated model stays canonical and single-sourced; only the verb form differs, so
 * {@code Messages.text(msg)} stands in for what other runtimes spell {@code msg.text()}.
 */
public final class Messages {

  /** Metadata key carrying the identifier of the tool call a tool message answers. */
  public static final String TOOL_CALL_ID = "tool_call_id";

  private Messages() {}

  /**
   * Concatenated text of a message's text parts.
   *
   * <p>Non-text parts contribute nothing, so an image-only message yields an empty string rather
   * than a placeholder.
   */
  public static String text(Message message) {
    if (message == null || message.parts == null) {
      return "";
    }
    StringBuilder builder = new StringBuilder();
    for (ContentPart part : message.parts) {
      if (part instanceof TextPart textPart && textPart.value != null) {
        builder.append(textPart.value);
      }
    }
    return builder.toString();
  }

  /** Whether a message carries any part that is not plain text. */
  public static boolean hasRichContent(Message message) {
    if (message == null || message.parts == null) {
      return false;
    }
    for (ContentPart part : message.parts) {
      if (!(part instanceof TextPart)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The message content in provider wire form.
   *
   * <p>A message that is entirely text collapses to a single string, which is what every provider
   * accepts and what keeps simple requests readable. Anything richer stays a list of typed parts.
   */
  public static Object toTextContent(Message message) {
    if (!hasRichContent(message)) {
      return text(message);
    }
    List<Object> parts = new ArrayList<>();
    SaveContext context = new SaveContext();
    for (ContentPart part : message.parts) {
      parts.add(part.save(context));
    }
    return parts;
  }

  /** A user message carrying a single text part. */
  public static Message user(String text) {
    return withText(Role.USER, text);
  }

  /** A system message carrying a single text part. */
  public static Message system(String text) {
    return withText(Role.SYSTEM, text);
  }

  /** An assistant message carrying a single text part. */
  public static Message assistant(String text) {
    return withText(Role.ASSISTANT, text);
  }

  /** A message with the given role carrying a single text part. */
  public static Message withText(Role role, String text) {
    Message message = new Message();
    message.role = role;
    message.parts = new ArrayList<>(List.of(textPart(text)));
    message.metadata = new LinkedHashMap<>();
    return message;
  }

  /**
   * A tool-result message answering a specific tool call.
   *
   * <p>The call identifier travels in metadata rather than in the content, so the result text stays
   * exactly what the tool returned.
   */
  public static Message toolResult(String toolCallId, String content) {
    Message message = withText(Role.TOOL, content);
    message.metadata.put(TOOL_CALL_ID, toolCallId);
    return message;
  }

  /** A text content part. */
  public static TextPart textPart(String value) {
    TextPart part = new TextPart();
    part.kind = "text";
    part.value = value == null ? "" : value;
    return part;
  }

  /** An image content part. */
  public static ImagePart imagePart(String source, String detail, String mediaType) {
    ImagePart part = new ImagePart();
    part.kind = "image";
    part.source = source;
    part.detail = detail;
    part.mediaType = mediaType;
    return part;
  }

  /** A file content part. */
  public static FilePart filePart(String source, String mediaType) {
    FilePart part = new FilePart();
    part.kind = "file";
    part.source = source;
    part.mediaType = mediaType;
    return part;
  }

  /** An audio content part. */
  public static AudioPart audioPart(String source, String mediaType) {
    AudioPart part = new AudioPart();
    part.kind = "audio";
    part.source = source;
    part.mediaType = mediaType;
    return part;
  }

  /** Metadata of a message, never null. */
  public static Map<String, Object> metadata(Message message) {
    if (message.metadata == null) {
      message.metadata = new LinkedHashMap<>();
    }
    return message.metadata;
  }
}
