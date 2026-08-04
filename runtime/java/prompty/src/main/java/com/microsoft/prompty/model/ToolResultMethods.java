// Typra extension seam. This file is created once and is safe to edit.
package com.microsoft.prompty.model;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Hand-written implementations for the {@code @method} declarations on
 * {@link ToolResult}.
 *
 * <p>The emitter creates this file once, when missing, and never rewrites it,
 * so it is the designated home for these bodies. Behaviour mirrors the Rust
 * reference implementation in {@code runtime/rust/prompty/src/model_ext.rs}.
 */
public final class ToolResultMethods {
  private ToolResultMethods() { }

  /** Concatenates every {@link TextPart} value, joined by newline. */
  public static String text(ToolResult self) {
    List<ContentPart> parts = self.parts == null ? List.of() : self.parts;
    return parts.stream()
        .filter(TextPart.class::isInstance)
        .map(part -> ((TextPart) part).value)
        .collect(Collectors.joining("\n"));
  }
}