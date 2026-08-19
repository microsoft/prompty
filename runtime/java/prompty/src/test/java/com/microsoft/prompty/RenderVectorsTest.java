package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Agent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Runs the shared {@code spec/vectors/render} suite against the registered template engines.
 *
 * <p>The vectors pin down the details that differ between template libraries and would otherwise
 * quietly change a prompt's meaning: whether output is HTML-escaped, what an undefined variable
 * renders as, which filters exist, and exactly how much whitespace survives.
 */
class RenderVectorsTest {

  @TestFactory
  List<DynamicTest> renderVectors() {
    Registry.bootstrap();
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> testCase : SpecVectors.readArray("render/render_vectors.json")) {
      String name = SpecVectors.string(testCase, "name");
      tests.add(dynamicTest(name, () -> runCase(name, testCase)));
    }
    return tests;
  }

  private void runCase(String name, Map<String, Object> testCase) {
    Map<String, Object> input = SpecVectors.map(testCase, "input");
    Map<String, Object> expected = SpecVectors.map(testCase, "expected");

    String template = SpecVectors.string(input, "template");
    String engine = SpecVectors.string(input, "engine");
    Map<String, Object> inputs = SpecVectors.map(input, "inputs");

    Agent agent = buildAgent(template, engine, inputs);
    String rendered = Pipeline.render(agent, stripKindMarkers(inputs));

    String exact = SpecVectors.string(expected, "rendered");
    if (exact != null) {
      assertEquals(exact, rendered, "[" + name + "] rendered output");
    }

    String pattern = SpecVectors.string(expected, "nonce_pattern");
    if (pattern != null) {
      assertTrue(
          Pattern.compile(pattern).matcher(rendered).find(),
          "[" + name + "] expected output matching /" + pattern + "/, got: " + rendered);
    }
  }

  /**
   * Build an agent whose declared inputs match the vector's values.
   *
   * <p>Rich inputs — threads, images, files, audio — never reach the template engine as values;
   * they are swapped for markers and spliced back in afterwards. Which inputs are rich is a property
   * of the agent's declaration, so a vector that exercises that path signals it with a {@code _kind}
   * marker on the value and the declaration is reconstructed from it here.
   */
  private static Agent buildAgent(String template, String engine, Map<String, Object> inputs) {
    List<Object> declared = new ArrayList<>();
    for (Map.Entry<String, Object> entry : inputs.entrySet()) {
      Map<String, Object> property = new LinkedHashMap<>();
      property.put("name", entry.getKey());
      property.put("kind", kindOf(entry.getValue()));
      declared.add(property);
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "test");
    data.put("model", Map.of("id", "test"));
    data.put("instructions", template);
    data.put("inputs", declared);
    data.put("template", Map.of("format", Map.of("kind", engine), "parser", Map.of("kind", "prompty")));
    return Agent.load(data, new LoadContext(null, null));
  }

  private static String kindOf(Object value) {
    if (value instanceof Map<?, ?> map && map.get("_kind") instanceof String kind) {
      return kind;
    }
    return "string";
  }

  /** Unwrap the {@code _kind} marker so rich values arrive as the payload the runtime would see. */
  private static Map<String, Object> stripKindMarkers(Map<String, Object> inputs) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : inputs.entrySet()) {
      Object value = entry.getValue();
      if (value instanceof Map<?, ?> map && map.containsKey("_kind")) {
        Object messages = map.get("messages");
        result.put(entry.getKey(), messages != null ? messages : map.get("value"));
      } else {
        result.put(entry.getKey(), value);
      }
    }
    return result;
  }

  /** Guards against a silent regression where every vector is skipped. */
  @org.junit.jupiter.api.Test
  void suiteIsComplete() {
    assertEquals(23, SpecVectors.readArray("render/render_vectors.json").size(), "render vector count");
  }
}
