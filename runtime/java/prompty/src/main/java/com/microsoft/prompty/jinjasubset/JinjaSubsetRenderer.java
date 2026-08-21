package com.microsoft.prompty.jinjasubset;

import java.util.List;
import java.util.Map;

/** Public entry point for the Prompty Jinja subset renderer. */
public final class JinjaSubsetRenderer {
  private JinjaSubsetRenderer() {}

  public static List<Segment> renderSegments(String template, Map<String, Object> inputs, Iterable<String> strictProps) {
    return Evaluator.renderSegments(template, inputs, strictProps);
  }

  public static String render(String template, Map<String, Object> inputs, Iterable<String> strictProps) {
    return Evaluator.render(template, inputs, strictProps);
  }

  public static String render(String template, Map<String, Object> inputs) {
    return render(template, inputs, List.of());
  }
}
