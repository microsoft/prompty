package com.microsoft.prompty.engine;

import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.TypraJson;

/**
 * Renders a tool result as the text the model sees.
 *
 * <p>This lives beside the engine rather than on the generated {@code ModelToolResult} because the
 * generated model layer is emitted and must not be hand-edited.
 */
public final class ToolResults {

  private ToolResults() {}

  /**
   * The model-visible text for a result.
   *
   * <p>A string output is passed through verbatim — wrapping it in JSON quotes would change what the
   * model reads. Anything else is serialized, and an absent output renders as empty rather than as
   * the literal {@code "null"}.
   *
   * <p>Divergence from the Rust reference: Rust holds the output as {@code Option<Value>} and so
   * distinguishes an absent output ({@code None} → {@code ""}) from a tool that explicitly returned
   * JSON null ({@code Some(Value::Null)} → {@code "null"}). Java's field is a plain {@code Object},
   * where both cases are {@code null}, so both render as empty. Closing this would mean carrying a
   * sentinel through the generated model layer, which is not worth it for a tool that returns a
   * bare null.
   */
  public static String modelText(ModelToolResult result) {
    if (result == null || result.output == null) {
      return "";
    }
    if (result.output instanceof String text) {
      return text;
    }
    return TypraJson.stringify(result.output);
  }
}
