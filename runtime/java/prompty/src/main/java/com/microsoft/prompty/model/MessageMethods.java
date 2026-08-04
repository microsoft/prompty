// Typra extension seam. This file is created once and is safe to edit.
package com.microsoft.prompty.model;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Hand-written implementations for the {@code @method} declarations on
 * {@link Message}.
 *
 * <p>The emitter creates this file once, when missing, and never rewrites it,
 * so it is the designated home for these bodies. Behaviour mirrors the Rust
 * reference implementation in {@code runtime/rust/prompty/src/model_ext.rs}.
 */
public final class MessageMethods {
  private MessageMethods() { }

  /**
   * Returns a plain string when every part is text, and the wire form of the
   * parts otherwise.
   *
   * <p>Providers accept a bare string for single-modality content but require
   * the structured form once a message carries an image, audio or file part.
   */
  public static Object toTextContent(Message self) {
    List<ContentPart> parts = self.parts == null ? List.of() : self.parts;
    boolean allText = parts.stream().allMatch(part -> part instanceof TextPart);
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

  /** Concatenates every {@link TextPart} value, joined by newline. */
  public static String text(Message self) {
    return joinText(self.parts == null ? List.of() : self.parts);
  }

  private static String joinText(List<ContentPart> parts) {
    return parts.stream()
        .filter(TextPart.class::isInstance)
        .map(part -> ((TextPart) part).value)
        .collect(Collectors.joining("\n"));
  }
}