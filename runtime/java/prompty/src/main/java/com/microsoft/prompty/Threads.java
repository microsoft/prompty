package com.microsoft.prompty;

import com.microsoft.prompty.model.ContentPart;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.TextPart;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Substitutes conversation history back into a parsed message list.
 *
 * <p>A thread input never reaches the template as text — the renderer sees only a nonce marker (see
 * {@link Nonces}). After parsing, the message holding that marker is split apart and the recorded
 * conversation is spliced in where the marker stood, so prior turns arrive as real messages with
 * their own roles rather than as a blob inside a system prompt.
 */
public final class Threads {

  private Threads() {}

  /**
   * Expand every nonce marker in {@code messages} using the matching value from {@code inputs}.
   *
   * <p>At most one marker is expanded per message: a message is a single turn, and a second marker
   * inside one would have no coherent role to fall back to. Text on either side of the marker is
   * preserved as messages of the original role, and dropped when it trims to nothing.
   *
   * @param nonces property name to marker, as returned by {@link Nonces#prepareRenderInputs}
   * @param inputs the original, unrewritten inputs, holding the real thread values
   */
  public static List<Message> expand(
      List<Message> messages, Map<String, String> nonces, Map<String, Object> inputs) {
    if (nonces == null || nonces.isEmpty()) {
      return new ArrayList<>(messages);
    }

    List<Message> result = new ArrayList<>();
    for (Message message : messages) {
      if (!expandInto(result, message, nonces, inputs)) {
        result.add(message);
      }
    }
    return result;
  }

  private static boolean expandInto(
      List<Message> result, Message message, Map<String, String> nonces, Map<String, Object> inputs) {
    if (message.parts == null) {
      return false;
    }
    for (ContentPart part : message.parts) {
      if (!(part instanceof TextPart textPart) || textPart.value == null) {
        continue;
      }
      for (Map.Entry<String, String> entry : nonces.entrySet()) {
        int index = textPart.value.indexOf(entry.getValue());
        if (index < 0) {
          continue;
        }
        String before = textPart.value.substring(0, index).trim();
        String after = textPart.value.substring(index + entry.getValue().length()).trim();

        if (!before.isEmpty()) {
          result.add(Messages.withText(message.role, before));
        }
        result.addAll(toMessages(inputs == null ? null : inputs.get(entry.getKey())));
        if (!after.isEmpty()) {
          result.add(Messages.withText(message.role, after));
        }
        return true;
      }
    }
    return false;
  }

  /** Convert a thread input value into messages. Anything unrecognised contributes nothing. */
  public static List<Message> toMessages(Object value) {
    List<Message> messages = new ArrayList<>();
    if (!(value instanceof List<?> items)) {
      return messages;
    }
    for (Object item : items) {
      Message message = toMessage(item);
      if (message != null) {
        messages.add(message);
      }
    }
    return messages;
  }

  /**
   * Convert one {@code {role, content}} entry into a message.
   *
   * <p>{@code content} may be a plain string or a list of content parts — both forms appear in
   * recorded conversations, and rejecting either would silently drop history.
   *
   * @return the message, or null if the entry has no recognisable role
   */
  public static Message toMessage(Object value) {
    if (!(value instanceof Map<?, ?> map)) {
      return null;
    }
    Object rawRole = map.get("role");
    if (!(rawRole instanceof String roleName)) {
      return null;
    }
    Role role;
    try {
      role = Role.fromValue(roleName);
    } catch (IllegalArgumentException e) {
      return null;
    }

    Message message = new Message();
    message.role = role;
    message.parts = contentParts(map.get("content"));
    message.metadata = new LinkedHashMap<>();

    Object metadata = map.get("metadata");
    if (metadata instanceof Map<?, ?> entries) {
      for (Map.Entry<?, ?> entry : entries.entrySet()) {
        message.metadata.put(String.valueOf(entry.getKey()), entry.getValue());
      }
    }
    return message;
  }

  private static List<ContentPart> contentParts(Object content) {
    List<ContentPart> parts = new ArrayList<>();
    if (content instanceof String text) {
      parts.add(Messages.textPart(text));
      return parts;
    }
    if (content instanceof List<?> items) {
      for (Object item : items) {
        if (item instanceof Map<?, ?> map) {
          Object value = map.get("value");
          Object kind = map.get("kind");
          if (kind == null || "text".equals(kind)) {
            parts.add(Messages.textPart(value == null ? "" : String.valueOf(value)));
          } else {
            parts.add(ContentPart.load(map, new com.microsoft.prompty.model.LoadContext()));
          }
        } else if (item instanceof String text) {
          parts.add(Messages.textPart(text));
        }
      }
      return parts;
    }
    parts.add(Messages.textPart(""));
    return parts;
  }
}
