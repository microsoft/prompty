package com.microsoft.prompty.anthropic;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.LiveEnv;
import com.microsoft.prompty.Pipeline;
import com.microsoft.prompty.Registry;
import com.microsoft.prompty.TurnOptions;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * End-to-end coverage against the real Anthropic API.
 *
 * <p>Anthropic's wire format differs from OpenAI's in ways the fixtures encode but cannot validate —
 * the system prompt is a top-level field rather than a message, tool results are user-role content
 * blocks, and structured output is expressed through a tool rather than a response format. These
 * tests confirm the service accepts what the runtime actually sends.
 *
 * <p>Excluded from the normal build by the {@code live} tag. Run with {@code -PliveTests} and an
 * {@code ANTHROPIC_API_KEY} in {@code runtime/java/.env}.
 */
@Tag("live")
@DisplayName("live: Anthropic")
final class AnthropicLiveTest {

  @BeforeAll
  static void setUp() {
    LiveEnv.load();
  }

  private static String modelId() {
    return LiveEnv.get("ANTHROPIC_MODEL", "claude-3-5-haiku-latest");
  }

  private static Prompty chatAgent(String question, Map<String, Object> options) {
    return LiveEnv.agent(
        new LiveEnv.Spec("anthropic", modelId())
            .chat("You are a helpful assistant. Be very brief.", question)
            .options(options));
  }

  @Test
  void chatCompletionReturnsText() {
    LiveEnv.require("ANTHROPIC_API_KEY");

    Object result =
        Pipeline.invoke(
            chatAgent("Say hello in exactly 3 words.", Map.of("temperature", 0, "maxOutputTokens", 100)),
            Map.of());

    String text = Pipeline.textOf(result);
    assertNotNull(text);
    assertFalse(text.isBlank(), "chat completion returned no text");
    System.out.println("[anthropic] chat -> " + text);
  }

  @Test
  void chatStreamingYieldsIncrementalChunksOverSse() {
    LiveEnv.require("ANTHROPIC_API_KEY");

    Map<String, Object> options = new LinkedHashMap<>();
    options.put("temperature", 0);
    options.put("maxOutputTokens", 400);
    // `stream` is not a declared model option; it rides in the passthrough bag, which is also where
    // the executor looks for it.
    options.put("additionalProperties", Map.of("stream", true));
    // Long enough that the service splits it across content-block deltas. A short answer arrives in
    // a single delta, which would let a parser that ignored incremental framing pass.
    Prompty agent =
        chatAgent("Count from 1 to 60, separated by spaces. Output only the numbers.", options);

    // Anthropic's SSE framing differs from OpenAI's — named events carrying content-block deltas
    // rather than one delta shape — so driving the parser directly is what proves the runtime reads
    // the real framing rather than a fixture's idealised version of it.
    List<Message> messages = Pipeline.prepare(agent, Map.of());
    Iterator<Object> raw = Registry.executor("anthropic").executeStream(agent, messages);
    Iterator<StreamChunk> chunks = Registry.processor("anthropic").processStream(agent, raw);

    StringBuilder text = new StringBuilder();
    int textChunks = 0;
    while (chunks.hasNext()) {
      StreamChunk chunk = chunks.next();
      if (chunk instanceof TextChunk t) {
        textChunks++;
        text.append(t.value);
      }
    }

    assertTrue(textChunks > 1, "expected more than one text chunk, got " + textChunks);
    assertTrue(text.toString().contains("60"), "expected the counted answer to reach 60: " + text);
    System.out.println("[anthropic] stream over sse -> " + textChunks + " chunks: " + text);
  }

  @Test
  void listModelsReturnsAtLeastOneModel() {
    LiveEnv.require("ANTHROPIC_API_KEY");

    Map<String, Object> connection = new LinkedHashMap<>();
    connection.put("kind", "key");
    List<ModelInfo> models = new AnthropicModelLister().listModels(connection);

    assertFalse(models.isEmpty(), "expected at least one model");
    assertTrue(
        models.stream().anyMatch(m -> m.id != null && !m.id.isBlank()),
        "every listed model should carry an id");
    System.out.println("[anthropic] models -> " + models.size() + " available");
  }

  @Test
  void structuredOutputParsesIntoDeclaredFields() {
    LiveEnv.require("ANTHROPIC_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("anthropic", modelId())
                .chat(
                    "Extract structured data from the user's message.",
                    "My name is Ada Lovelace and I am 36 years old.")
                .options(Map.of("temperature", 0, "maxOutputTokens", 512))
                .outputs(
                    List.of(
                        Map.of("name", "name", "kind", "string", "required", true),
                        Map.of("name", "age", "kind", "integer", "required", true))));

    Object result = Pipeline.invoke(agent, Map.of());

    Map<?, ?> fields = assertInstanceOf(Map.class, result, "structured output should yield a map");
    assertTrue(fields.containsKey("name"), "missing declared field 'name' in " + fields);
    assertTrue(fields.containsKey("age"), "missing declared field 'age' in " + fields);
    assertTrue(
        String.valueOf(fields.get("name")).contains("Ada"),
        "expected the extracted name to mention Ada but got: " + fields.get("name"));
    System.out.println("[anthropic] structured -> " + fields);
  }

  @Test
  void agentTurnCallsAToolAndUsesTheResult() {
    LiveEnv.require("ANTHROPIC_API_KEY");

    Map<String, Object> location = new LinkedHashMap<>();
    location.put("name", "location");
    location.put("kind", "string");
    location.put("description", "The city to report on");
    location.put("required", true);

    Map<String, Object> tool = new LinkedHashMap<>();
    tool.put("name", "get_weather");
    tool.put("kind", "function");
    tool.put("description", "Get the current weather for a city");
    tool.put("parameters", List.of(location));

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("anthropic", modelId())
                .apiType("agent")
                .chat(
                    "You are a helpful assistant. Use the provided tools when they apply.",
                    "What is the weather in Paris? Use the get_weather tool.")
                .options(Map.of("temperature", 0, "maxOutputTokens", 512))
                .tools(List.of(tool)));

    boolean[] called = {false};
    TurnOptions options =
        TurnOptions.builder()
            .tool(
                "get_weather",
                arguments -> {
                  called[0] = true;
                  System.out.println("[anthropic] tool invoked with " + arguments);
                  return "{\"temperature\":\"18C\",\"conditions\":\"cloudy\"}";
                })
            .build();

    Object result = Pipeline.turn(agent, Map.of(), options);

    assertTrue(called[0], "the model never called the tool");
    String text = Pipeline.textOf(result);
    assertFalse(text.isBlank(), "the turn produced no final text");
    assertTrue(
        text.contains("18") || text.toLowerCase().contains("cloud"),
        "expected the answer to reflect the tool result but got: " + text);
    System.out.println("[anthropic] agent -> " + text);
  }
}
