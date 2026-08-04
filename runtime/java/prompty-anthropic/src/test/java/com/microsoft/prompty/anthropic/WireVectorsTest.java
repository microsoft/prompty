package com.microsoft.prompty.anthropic;

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
 * Grades the Anthropic wire conversion against the shared {@code spec/vectors/wire} suite.
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
      if (!"anthropic".equals(input.get("provider"))) {
        continue;
      }

      tests.add(DynamicTest.dynamicTest(name, () -> runVector(name, vector, input)));
    }
    return tests;
  }

  private static void runVector(String name, Map<String, Object> vector, Map<String, Object> input) {
    Prompty agent = VectorAgents.buildAgent(input, "claude-3", "anthropic");
    List<Message> messages = VectorAgents.buildMessages(input);
    String apiType = String.valueOf(input.getOrDefault("apiType", "chat"));

    // Anthropic exposes a single endpoint; anything else is a vector this provider cannot serve.
    if (!"chat".equals(apiType) && !"agent".equals(apiType)) {
      throw new AssertionError("Anthropic vectors must use apiType chat or agent, got: " + apiType);
    }

    Map<String, Object> actual = Wire.buildChatArgs(agent, messages);
    Object expected = SpecVectors.map(vector, "expected").get("request_body");
    SpecVectors.assertEquivalent(name, expected, actual);
  }
}
