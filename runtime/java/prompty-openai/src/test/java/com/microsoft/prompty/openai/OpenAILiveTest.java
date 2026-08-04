package com.microsoft.prompty.openai;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Environment;
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
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * End-to-end coverage against the real OpenAI API.
 *
 * <p>Every other suite grades the runtime against recorded fixtures, which proves the runtime agrees
 * with the shared spec but not that the spec matches what OpenAI actually accepts. These tests close
 * that gap: they send real requests and assert on real responses, so a wire shape that the fixtures
 * bless but the service rejects fails here.
 *
 * <p>Excluded from the normal build by the {@code live} tag. Run with {@code -PliveTests} and an
 * {@code OPENAI_API_KEY} in {@code runtime/java/.env}.
 */
@Tag("live")
@DisplayName("live: OpenAI")
final class OpenAILiveTest {

  @BeforeAll
  static void setUp() {
    LiveEnv.load();
  }

  private static String modelId() {
    return LiveEnv.get("OPENAI_MODEL", "gpt-4o-mini");
  }

  private static Prompty chatAgent(String question, Map<String, Object> options) {
    return LiveEnv.agent(
        new LiveEnv.Spec("openai", modelId())
            .chat("You are a helpful assistant. Be very brief.", question)
            .options(options));
  }

  // ------------------------------------------------------------------ chat

  @Test
  void chatCompletionReturnsText() {
    LiveEnv.require("OPENAI_API_KEY");

    Object result =
        Pipeline.invoke(
            chatAgent("Say hello in exactly 3 words.", Map.of("temperature", 0, "maxOutputTokens", 100)),
            Map.of());

    String text = Pipeline.textOf(result);
    assertNotNull(text);
    assertFalse(text.isBlank(), "chat completion returned no text");
    System.out.println("[openai] chat -> " + text);
  }

  @Test
  void chatHonoursDeterministicTemperature() {
    LiveEnv.require("OPENAI_API_KEY");

    Object result =
        Pipeline.invoke(
            chatAgent(
                "What is 2+2? Reply with just the number.",
                Map.of("temperature", 0, "maxOutputTokens", 10)),
            Map.of());

    String text = Pipeline.textOf(result);
    assertTrue(text.contains("4"), "expected the answer to contain 4 but got: " + text);
    System.out.println("[openai] temperature -> " + text);
  }

  @Test
  void chatStreamingAccumulatesIntoTheSameAnswerShape() {
    LiveEnv.require("OPENAI_API_KEY");

    Map<String, Object> options = new LinkedHashMap<>();
    options.put("temperature", 0);
    options.put("maxOutputTokens", 60);
    // `stream` is not a declared model option; it rides in the passthrough bag, which is also where
    // the executor looks for it.
    options.put("additionalProperties", Map.of("stream", true));
    Prompty agent = chatAgent("Count from 1 to 5, separated by spaces.", options);

    // `invoke` deliberately collapses a stream into the finished answer, so a caller who only wants
    // the result does not have to know whether the transport streamed.
    Object result = Pipeline.invoke(agent, Map.of());

    String text = assertInstanceOf(String.class, result, "invoke should collapse a stream to text");
    assertFalse(text.isBlank(), "stream produced no text");
    assertTrue(text.contains("5"), "expected the counted answer to reach 5 but got: " + text);
    System.out.println("[openai] stream via invoke -> " + text);
  }

  @Test
  void chatStreamingYieldsIncrementalChunksOverSse() {
    LiveEnv.require("OPENAI_API_KEY");

    Map<String, Object> options = new LinkedHashMap<>();
    options.put("temperature", 0);
    options.put("maxOutputTokens", 60);
    options.put("additionalProperties", Map.of("stream", true));
    Prompty agent = chatAgent("Count from 1 to 10, separated by spaces.", options);

    // Driving the executor and processor directly is what proves the SSE parser copes with real
    // chunk boundaries; going through `invoke` would hide that behind the accumulated string.
    List<Message> messages = Pipeline.prepare(agent, Map.of());
    Iterator<Object> raw = Registry.executor("openai").executeStream(agent, messages);
    Iterator<StreamChunk> chunks = Registry.processor("openai").processStream(agent, raw);

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
    assertTrue(text.toString().contains("10"), "expected the counted answer to reach 10: " + text);
    System.out.println("[openai] stream over sse -> " + textChunks + " chunks: " + text);
  }

  // ------------------------------------------------------------------ other api types

  @Test
  void embeddingReturnsAVector() {
    LiveEnv.require("OPENAI_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("openai", LiveEnv.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
                .apiType("embedding")
                .instructions("user:\nThe quick brown fox."));

    Object result = Pipeline.invoke(agent, Map.of());

    List<?> vector = assertInstanceOf(List.class, result, "embedding should yield a list");
    assertFalse(vector.isEmpty(), "embedding vector was empty");
    assertInstanceOf(Number.class, vector.get(0), "embedding values should be numeric");
    System.out.println("[openai] embedding -> " + vector.size() + " dimensions");
  }

  @Test
  void imageGenerationReturnsAReference() {
    LiveEnv.require("OPENAI_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("openai", LiveEnv.get("OPENAI_IMAGE_MODEL", "gpt-image-1-mini"))
                .apiType("image")
                .instructions("user:\nA small red circle on a white background.")
                .options(Map.of("additionalProperties", Map.of("size", "1024x1024"))));

    Object result;
    try {
      result = Pipeline.invoke(agent, Map.of());
    } catch (RuntimeException e) {
      // Image models are a separate entitlement. A key without one says nothing about the runtime,
      // so that specific rejection skips; every other rejection is a real failure and propagates.
      String message = String.valueOf(e.getMessage());
      Assumptions.assumeFalse(
          message.contains("does not exist") || message.contains("must be verified"),
          () -> "live test skipped: this key has no image model entitlement -- " + message);
      throw e;
    }

    assertNotNull(result, "image generation returned nothing");
    String rendered = String.valueOf(result);
    assertFalse(rendered.isBlank(), "image generation returned an empty reference");
    System.out.println(
        "[openai] image -> " + rendered.substring(0, Math.min(80, rendered.length())) + "...");
  }

  @Test
  void listModelsReturnsTheConfiguredModel() {
    LiveEnv.require("OPENAI_API_KEY");

    Map<String, Object> connection = new LinkedHashMap<>();
    connection.put("kind", "key");
    List<ModelInfo> models = new OpenAIModelLister().listModels(connection);

    assertFalse(models.isEmpty(), "expected at least one model");
    assertTrue(
        models.stream().anyMatch(m -> m.id != null && !m.id.isBlank()),
        "every listed model should carry an id");
    System.out.println("[openai] models -> " + models.size() + " available");
  }

  // ------------------------------------------------------------------ structured output

  @Test
  void structuredOutputParsesIntoDeclaredFields() {
    LiveEnv.require("OPENAI_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("openai", modelId())
                .chat(
                    "Extract structured data from the user's message.",
                    "My name is Ada Lovelace and I am 36 years old.")
                .options(Map.of("temperature", 0))
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
    System.out.println("[openai] structured -> " + fields);
  }

  /**
   * A nested optional field is the shape that motivated recursive strict widening: OpenAI rejects a
   * strict schema whose nested object leaves a key out of {@code required}, so this asserts against
   * the service what {@code WireSchemaTest} asserts against the wire builder. The optional key is
   * genuinely absent from the prompt, so a faithful schema must let the model return null for it
   * rather than force a fabricated value.
   */
  @Test
  void structuredOutputHandlesNestedOptionalFields() {
    LiveEnv.require("OPENAI_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("openai", modelId())
                .chat(
                    "Extract structured data from the user's message.",
                    "Ada Lovelace lives in London. Her postcode is not mentioned.")
                .options(Map.of("temperature", 0))
                .outputs(
                    List.of(
                        Map.of("name", "name", "kind", "string", "required", true),
                        Map.of(
                            "name",
                            "address",
                            "kind",
                            "object",
                            "required",
                            true,
                            "properties",
                            List.of(
                                Map.of("name", "city", "kind", "string", "required", true),
                                Map.of(
                                    "name", "postcode", "kind", "string", "required", false))))));

    Object result = Pipeline.invoke(agent, Map.of());

    Map<?, ?> fields = assertInstanceOf(Map.class, result, "structured output should yield a map");
    Map<?, ?> address =
        assertInstanceOf(Map.class, fields.get("address"), "missing nested object in " + fields);
    assertTrue(
        String.valueOf(address.get("city")).toLowerCase().contains("london"),
        "expected the nested required field to be extracted but got: " + address);
    assertTrue(
        address.containsKey("postcode"),
        "strict mode names every nested key, so the optional one must still come back: " + address);
    System.out.println("[openai] nested structured -> " + fields);
  }

  // ------------------------------------------------------------------ tool calling

  @Test
  void agentTurnCallsAToolAndUsesTheResult() {
    LiveEnv.require("OPENAI_API_KEY");

    Prompty agent =
        LiveEnv.agent(
            new LiveEnv.Spec("openai", modelId())
                .apiType("agent")
                .chat(
                    "You are a helpful assistant. Use the provided tools when they apply.",
                    "What is the weather in Paris? Use the get_weather tool.")
                .options(Map.of("temperature", 0))
                .tools(List.of(weatherTool())));

    boolean[] called = {false};
    TurnOptions options =
        TurnOptions.builder()
            .tool(
                "get_weather",
                arguments -> {
                  called[0] = true;
                  System.out.println("[openai] tool invoked with " + arguments);
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
    System.out.println("[openai] agent -> " + text);
  }

  /** A minimal function tool, shaped the way the TypeSpec model declares parameters. */
  static Map<String, Object> weatherTool() {
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
    return tool;
  }

  @Test
  void anInvalidKeyIsReportedRatherThanSwallowed() {
    LiveEnv.require("OPENAI_API_KEY");

    String saved = Environment.lookup("OPENAI_API_KEY").orElse("");
    Environment.set("OPENAI_API_KEY", "sk-definitely-not-a-real-key");
    try {
      Object result =
          Pipeline.invoke(chatAgent("Hello", Map.of("temperature", 0, "maxOutputTokens", 5)), Map.of());
      // A rejected request must surface as a failure, not as a plausible-looking empty answer.
      throw new AssertionError("expected an authentication failure but got: " + result);
    } catch (AssertionError e) {
      throw e;
    } catch (RuntimeException e) {
      String message = String.valueOf(e.getMessage());
      assertFalse(message.contains("sk-definitely-not-a-real-key"), "the key must not appear in the error");
      System.out.println("[openai] auth failure -> " + message);
    } finally {
      Environment.set("OPENAI_API_KEY", saved);
    }
  }
}
