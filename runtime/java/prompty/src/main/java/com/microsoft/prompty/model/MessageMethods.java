// <typra-editable-seam>
// Typra editable seam. This file is created once and is safe to edit.
package com.microsoft.prompty.model;

import java.util.ArrayList;
import java.util.List;

/**
 * Hand-written {@code @method} implementations for {@link Message}.
 *
 * <p>Mirrors the Rust reference in {@code runtime/rust/prompty/src/model_ext.rs}: {@code text}
 * concatenates the message's text parts and {@code toTextContent} collapses an all-text message to a
 * single string while a message carrying any rich part serializes to its wire array of parts.
 */
public final class MessageMethods {
  private MessageMethods() { }

  /**
   * A scalar string when every part is text, otherwise the wire array of serialized parts.
   *
   * <p>An empty part list vacuously satisfies "every part is text", keeping empty messages scalar.
   */
  public static Object toTextContent(Message self) {
    List<ContentPart> parts = self.parts == null ? List.of() : self.parts;
    boolean allText = true;
    for (ContentPart part : parts) {
      if (!(part instanceof TextPart)) {
        allText = false;
        break;
      }
    }
    if (allText) {
      return joinText(parts);
    }
    SaveContext ctx = new SaveContext();
    List<Object> wire = new ArrayList<>(parts.size());
    for (ContentPart part : parts) {
      wire.add(part.save(ctx));
    }
    return wire;
  }

  /** The message's text parts joined with newlines; non-text parts are ignored. */
  public static String text(Message self) {
    return joinText(self.parts);
  }

  private static String joinText(List<ContentPart> parts) {
    if (parts == null) {
      return "";
    }
    StringBuilder joined = new StringBuilder();
    boolean first = true;
    for (ContentPart part : parts) {
      if (part instanceof TextPart textPart) {
        if (!first) {
          joined.append('\n');
        }
        joined.append(textPart.value);
        first = false;
      }
    }
    return joined.toString();
  }

}
