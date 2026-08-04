package com.microsoft.prompty.openai;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.SaveContext;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
    Prompty agent = buildAgent(input);
    List<Message> messages = buildMessages(input);
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
    SpecVectors.assertMatches(name, expected, actual);
  }

  /** Rebuild the agent from the vector's declarative description. */
  private static Prompty buildAgent(Map<String, Object> input) {
    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", input.getOrDefault("model_id", "gpt-4"));
    model.put("apiType", input.getOrDefault("apiType", "chat"));
    model.put("provider", input.getOrDefault("provider", "openai"));
    if (input.get("options") instanceof Map<?, ?> options && !options.isEmpty()) {
      model.put("options", options);
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", model);
    if (input.get("tools") instanceof List<?> tools && !tools.isEmpty()) {
      data.put("tools", tools);
    }
    if (input.get("outputs") instanceof List<?> outputs && !outputs.isEmpty()) {
      data.put("outputs", outputs);
    }
    return Prompty.load(data, new LoadContext());
  }

  /**
   * Rebuild the messages the vector describes.
   *
   * <p>The fixtures name every part's payload {@code value}, while the model names it {@code source}
   * for the parts that reference external media. Translating here keeps the fixtures uniform across
   * runtimes and confines the difference to the harness, as the Rust suite also does.
   */
  private static List<Message> buildMessages(Map<String, Object> input) {
    List<Message> messages = new ArrayList<>();
    if (!(input.get("messages") instanceof List<?> raw)) {
      return messages;
    }

    LoadContext context = new LoadContext();
    for (Object entry : raw) {
      if (!(entry instanceof Map<?, ?> message)) {
        continue;
      }
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("role", message.get("role"));

      List<Object> parts = new ArrayList<>();
      if (message.get("content") instanceof List<?> content) {
        for (Object part : content) {
          parts.add(part instanceof Map<?, ?> map ? normalizePart(map) : part);
        }
      }
      data.put("parts", parts);
      if (message.get("metadata") != null) {
        data.put("metadata", message.get("metadata"));
      }
      messages.add(Message.load(data, context));
    }
    return messages;
  }

  private static Map<String, Object> normalizePart(Map<?, ?> part) {
    Map<String, Object> normalized = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : part.entrySet()) {
      String key = String.valueOf(entry.getKey());
      boolean isText = "text".equals(part.get("kind"));
      normalized.put("value".equals(key) && !isText ? "source" : key, entry.getValue());
    }
    return normalized;
  }
}
