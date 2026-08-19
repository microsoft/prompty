package com.microsoft.prompty;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Agent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Rebuilds prompts and messages from the declarative descriptions in the shared spec vectors.
 *
 * <p>Every provider suite needs the same reconstruction, and a provider that reconstructed vectors
 * its own way could pass while disagreeing with the others about what the fixture said. Keeping one
 * implementation here means the suites differ only in the conversion they are grading.
 */
public final class VectorAgents {

  private VectorAgents() {}

  /**
   * Rebuild the prompt a wire vector describes.
   *
   * @param defaultModelId the model id to use when the vector does not name one
   * @param defaultProvider the provider to assume when the vector does not name one
   */
  public static Agent buildAgent(
      Map<String, Object> input, String defaultModelId, String defaultProvider) {
    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", input.getOrDefault("model_id", defaultModelId));
    model.put("apiType", input.getOrDefault("apiType", "chat"));
    model.put("provider", input.getOrDefault("provider", defaultProvider));
    // Empty collections are omitted rather than passed through, because an empty `options` object
    // and an absent one mean the same thing to a prompt but not to every loader.
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
    return Agent.load(data, new LoadContext());
  }

  /**
   * Rebuild the messages a vector describes.
   *
   * <p>The fixtures name every part's payload {@code value} and the message's parts {@code content},
   * while the model names them {@code source} and {@code parts}. Translating here keeps the fixtures
   * uniform across runtimes and confines the difference to the harness, as the Rust suite also does.
   */
  public static List<Message> buildMessages(Map<String, Object> input) {
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

  /**
   * Rebuild the prompt a process vector implies.
   *
   * <p>Only {@code has_outputs} matters for these: declaring outputs is what makes a processor
   * attempt to decode structured JSON rather than hand back text.
   */
  public static Agent buildProcessAgent(
      Map<String, Object> input, String modelId, String provider) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", Map.of("id", modelId, "provider", provider));
    if (Boolean.TRUE.equals(input.get("has_outputs"))) {
      data.put("outputs", List.of(Map.of("name", "result", "kind", "string")));
    }
    return Agent.load(data, new LoadContext());
  }

  private static Map<String, Object> normalizePart(Map<?, ?> part) {
    Map<String, Object> normalized = new LinkedHashMap<>();
    boolean isText = "text".equals(part.get("kind"));
    for (Map.Entry<?, ?> entry : part.entrySet()) {
      String key = String.valueOf(entry.getKey());
      normalized.put("value".equals(key) && !isText ? "source" : key, entry.getValue());
    }
    return normalized;
  }
}
