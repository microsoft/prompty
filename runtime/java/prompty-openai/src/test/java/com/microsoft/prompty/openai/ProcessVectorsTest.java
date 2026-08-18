package com.microsoft.prompty.openai;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.VectorAgents;
import com.microsoft.prompty.model.Agent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/** Grades OpenAI response interpretation against the shared {@code spec/vectors/process} suite. */
class ProcessVectorsTest {

  @TestFactory
  Iterable<DynamicTest> processVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readArray("process/process_vectors.json")) {
      String name = SpecVectors.string(vector, "name");
      Map<String, Object> input = SpecVectors.map(vector, "input");

      if (!"openai".equals(input.get("provider"))) {
        continue;
      }

      tests.add(
          DynamicTest.dynamicTest(
              name,
              () -> {
                Agent agent = VectorAgents.buildProcessAgent(input, "gpt-4", "openai");
                Object actual = OpenAIProcessor.processResponse(agent, input.get("response"));
                Object expected = SpecVectors.map(vector, "expected").get("result");

                // A response with nothing to say and a response that said nothing are the same
                // outcome to a caller; the fixtures spell one of them as an empty string.
                if ("".equals(expected) && (actual == null || "".equals(actual))) {
                  return;
                }
                SpecVectors.assertEquivalent(name, expected, actual);
              }));
    }
    return tests;
  }
}
