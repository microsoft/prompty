package com.microsoft.prompty.openai;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Prompty;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/** Grades OpenAI response interpretation against the shared {@code spec/vectors/process} suite. */
class ProcessVectorsTest {

  @TestFactory
  Iterable<DynamicTest> processVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector :
        SpecVectors.readArray("process/process_vectors.json")) {
      String name = SpecVectors.string(vector, "name");
      Map<String, Object> input = SpecVectors.map(vector, "input");

      if (!"openai".equals(input.get("provider"))) {
        continue;
      }

      tests.add(
          DynamicTest.dynamicTest(
              name,
              () -> {
                Prompty agent = buildAgent(input);
                Object actual = OpenAIProcessor.processResponse(agent, input.get("response"));
                Object expected = SpecVectors.map(vector, "expected").get("result");

                // A response with nothing to say and a response that said nothing are the same
                // outcome to a caller; the fixtures spell one of them as an empty string.
                if ("".equals(expected) && (actual == null || "".equals(actual))) {
                  return;
                }
                SpecVectors.assertMatches(name, expected, actual);
              }));
    }
    return tests;
  }

  /**
   * Build the agent the vector implies.
   *
   * <p>Only {@code has_outputs} matters here: declaring outputs is what makes the processor attempt
   * to decode structured JSON rather than hand back text.
   */
  private static Prompty buildAgent(Map<String, Object> input) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", Map.of("id", "gpt-4", "provider", "openai"));
    if (Boolean.TRUE.equals(input.get("has_outputs"))) {
      data.put("outputs", List.of(Map.of("name", "result", "kind", "string")));
    }
    return Prompty.load(data, new LoadContext());
  }
}
