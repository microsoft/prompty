package com.microsoft.prompty.openai;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.VectorAgents;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Prompty;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Grades the OpenAI wire conversion against the shared {@code spec/vectors/wire} suite.
 *
 * <p>These are the same fixtures every other runtime is measured by, so a vector that passes here
 * is evidence of cross-runtime agreement rather than merely of internal consistency.
 */
class WireVectorsTest {

  @TestFactory
  Iterable<DynamicTest> wireVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readArray("wire/wire_vectors.json")) {
      String name = SpecVectors.string(vector, "name");
      Map<String, Object> input = SpecVectors.map(vector, "input");

      // Vectors for other providers are graded by those providers' suites.
      if (!"openai".equals(input.getOrDefault("provider", "openai"))) {
        continue;
      }

      tests.add(DynamicTest.dynamicTest(name, () -> runVector(name, vector, input)));
    }
    return tests;
  }

  private static void runVector(String name, Map<String, Object> vector, Map<String, Object> input) {
    Prompty agent = VectorAgents.buildAgent(input, "gpt-4", "openai");
    List<Message> messages = VectorAgents.buildMessages(input);
    String apiType = String.valueOf(input.getOrDefault("apiType", "chat"));

    Map<String, Object> actual =
        switch (apiType) {
          case "chat", "agent" -> Wire.buildChatArgs(agent, messages);
          case "responses" -> Wire.buildResponsesArgs(agent, messages);
          case "embedding" -> Wire.buildEmbeddingArgs(agent, messages);
          case "image" -> Wire.buildImageArgs(agent, messages);
          default -> throw new AssertionError("Unknown apiType: " + apiType);
        };

    Object expected = SpecVectors.map(vector, "expected").get("request_body");
    SpecVectors.assertEquivalent(name, expected, actual);
  }
}
