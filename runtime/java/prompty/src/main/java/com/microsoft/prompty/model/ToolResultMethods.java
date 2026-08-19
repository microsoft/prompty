// <typra-editable-seam>
// Typra editable seam. This file is created once and is safe to edit.
package com.microsoft.prompty.model;

import java.util.List;

/**
 * Hand-written {@code @method} implementation for {@link ToolResult}.
 *
 * <p>Mirrors the Rust reference in {@code runtime/rust/prompty/src/model_ext.rs}: {@code text}
 * concatenates the result's text parts with newlines and ignores any non-text part.
 */
public final class ToolResultMethods {
  private ToolResultMethods() { }

  /** The result's text parts joined with newlines; non-text parts are ignored. */
  public static String text(ToolResult self) {
    List<ContentPart> parts = self.parts;
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
