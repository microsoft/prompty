package com.microsoft.prompty.openai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.VectorAgents;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Grades OpenAI response interpretation against the shared {@code spec/vectors/process} suite. */
class ProcessVectorsTest {

  @TestFactory
  Iterable<DynamicTest> processVectors() {
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> vector : SpecVectors.readArray("process/process_vectors.json")) {
      String name = SpecVectors.string(vector, "name");
      Map<String, Object> input = SpecVectors.map(vector, "input");

      if (!"openai".equals(VectorAgents.seamProvider(input, ""))) {
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

  @Test
  void portableAssistantMessagesUseResponsesMessageContentFallback() {
    Agent agent = new Agent();
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("object", "response");
    response.put("id", "resp_123");
    response.put(
        "output",
        List.of(
            Map.of(
                "type",
                "message",
                "role",
                "assistant",
                "status",
                "completed",
                "content",
                List.of(Map.of("type", "output_text", "text", "Visible final answer.")))));

    ModelInvocationRequest request = new ModelInvocationRequest();
    request.context = new ModelInvocationContextSnapshot();

    OpenAIProcessor processor =
        new OpenAIProcessor() {
          @Override
          protected boolean supportsResponsesContinuation() {
            return false;
          }
        };
    ModelInvocationResponse result = processor.processWithContext(agent, response, request);

    assertEquals("Visible final answer.", result.output);
    assertEquals(1, result.assistantMessages.size());
    assertEquals("Visible final answer.", Messages.text(result.assistantMessages.get(0)));
  }
}
