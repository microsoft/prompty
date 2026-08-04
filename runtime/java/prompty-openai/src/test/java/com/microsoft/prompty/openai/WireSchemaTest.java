package com.microsoft.prompty.openai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Streams;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Prompty;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Schema conversion tests that go beyond the shared vectors.
 *
 * <p>The vectors cover the shapes every runtime must agree on; these cover the awkward corners of
 * OpenAI's strict-mode JSON Schema dialect, where getting it wrong produces a request the API
 * rejects outright rather than a subtly different response.
 */
class WireSchemaTest {

  /** Build a strict function tool around the given parameters and return its emitted schema. */
  private static Map<String, Object> functionParametersSchema(List<Object> parameters) {
    Map<String, Object> tool = new LinkedHashMap<>();
    tool.put("name", "set_row_visual");
    tool.put("kind", "function");
    tool.put("strict", true);
    tool.put("parameters", parameters);

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "set-row-visual-test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", Map.of("id", "gpt-4", "provider", "openai"));
    data.put("tools", List.of(tool));

    Prompty agent = Prompty.load(data, new LoadContext());
    Map<String, Object> request = Wire.buildChatArgs(agent, List.of());
    Object schema = Streams.pointer(request, "tools", 0, "function", "parameters");
    return castMap(schema);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> castMap(Object value) {
    return (Map<String, Object>) assertInstanceOf(Map.class, value);
  }

  /** An empty {@code type} is not valid JSON Schema, so it must never reach the wire. */
  private static void assertNoEmptyType(Object schema) {
    if (schema instanceof Map<?, ?> map) {
      assertNotEquals("", map.get("type"), "schemas must not emit an empty type: " + schema);
      map.values().forEach(WireSchemaTest::assertNoEmptyType);
    } else if (schema instanceof List<?> list) {
      list.forEach(WireSchemaTest::assertNoEmptyType);
    }
  }

  private static Object at(Object root, Object... path) {
    return Streams.pointer(root, path);
  }

  @Test
  void nestedUnionsAndOptionalityWiden() {
    Map<String, Object> schema =
        functionParametersSchema(
            List.of(
                Map.of(
                    "name",
                    "row",
                    "kind",
                    "object",
                    "required",
                    true,
                    "properties",
                    List.of(
                        Map.of("name", "color", "kind", "string", "nullable", true, "required", true),
                        Map.of(
                            "name",
                            "border",
                            "kind",
                            "union",
                            "nullable",
                            true,
                            "required",
                            false,
                            "anyOf",
                            List.of(
                                Map.of("kind", "string", "enumValues", List.of("thin")),
                                Map.of("kind", "string", "enumValues", List.of("thick")))),
                        Map.of(
                            "name",
                            "fill",
                            "kind",
                            "union",
                            "required",
                            true,
                            "anyOf",
                            List.of(
                                Map.of("kind", "string"),
                                Map.of(
                                    "kind",
                                    "object",
                                    "properties",
                                    List.of(
                                        Map.of("name", "theme", "kind", "string", "required", true),
                                        Map.of(
                                            "name",
                                            "tint",
                                            "kind",
                                            "float",
                                            "required",
                                            false)))))))));

    assertEquals("object", at(schema, "properties", "row", "type"));
    // Nested objects list only their genuinely required members, matching every other runtime.
    // OpenAI's strict mode actually wants every key listed at every level, so a nested optional
    // yields a schema the API rejects — but that rule lives in the shared spec, so it is reported
    // upstream rather than fixed in one runtime, which would break cross-runtime agreement.
    assertEquals(List.of("color", "fill"), at(schema, "properties", "row", "required"));
    assertEquals(
        List.of("string", "null"), at(schema, "properties", "row", "properties", "color", "type"));

    assertEquals(
        "string", at(schema, "properties", "row", "properties", "border", "anyOf", 0, "type"));
    assertEquals(
        "string", at(schema, "properties", "row", "properties", "border", "anyOf", 1, "type"));
    assertEquals(
        Map.of("type", "null"),
        at(schema, "properties", "row", "properties", "border", "anyOf", 2));

    assertEquals("string", at(schema, "properties", "row", "properties", "fill", "anyOf", 0, "type"));
    assertEquals("object", at(schema, "properties", "row", "properties", "fill", "anyOf", 1, "type"));
    assertEquals(
        List.of("theme"),
        at(schema, "properties", "row", "properties", "fill", "anyOf", 1, "required"));

    assertNoEmptyType(schema);
  }

  @Test
  void strictModeRequiresEveryParameterAndWidensOptionals() {
    Map<String, Object> schema =
        functionParametersSchema(
            List.of(
                Map.of(
                    "name",
                    "choice",
                    "kind",
                    "string",
                    "required",
                    false,
                    "nullable",
                    true,
                    "enumValues",
                    List.of("yes", "no")),
                Map.of(
                    "name", "extension", "kind", "my-extension", "required", false, "nullable", true)));

    // Strict mode forbids optional keys, so optionality is expressed by allowing null instead.
    assertEquals(List.of("choice", "extension"), schema.get("required"));
    assertEquals(List.of("string", "null"), at(schema, "properties", "choice", "type"));
    assertEquals(Arrays.asList("yes", "no", null), at(schema, "properties", "choice", "enum"));

    // An unrecognised kind has no JSON Schema equivalent; emitting `{}` accepts anything, which is
    // strictly better than inventing a type the caller did not ask for.
    assertEquals(Map.of(), at(schema, "properties", "extension"));
  }

  @Test
  void oneOfUnionsAreRejected() {
    // OpenAI's strict dialect does not support oneOf; failing here beats a 400 from the API.
    assertThrows(
        SchemaException.class,
        () ->
            functionParametersSchema(
                List.of(
                    Map.of(
                        "name",
                        "invalid",
                        "kind",
                        "union",
                        "oneOf",
                        List.of(Map.of("kind", "string"), Map.of("kind", "integer"))))));
  }

  @Test
  void malformedUnionsAreRejectedRatherThanCrashing() {
    List<Map<String, Object>> malformed =
        List.of(
            Map.of("name", "invalid", "kind", "union"),
            Map.of(
                "name",
                "invalid",
                "kind",
                "union",
                "oneOf",
                List.of(Map.of("kind", "string")),
                "anyOf",
                List.of(Map.of("kind", "integer"))));

    for (Map<String, Object> union : malformed) {
      assertThrows(SchemaException.class, () -> functionParametersSchema(List.of(union)));
    }
  }

  @Test
  void floatOptionsAreNarrowedWithoutBinaryArtifacts() {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put(
        "model",
        Map.of("id", "gpt-4", "provider", "openai", "options", Map.of("temperature", 0.7)));

    Prompty agent = Prompty.load(data, new LoadContext());
    Map<String, Object> request = Wire.buildChatArgs(agent, List.of());

    // A naive float-to-double widening turns 0.7 into 0.699999988079071 on the wire.
    assertEquals("0.7", String.valueOf(request.get("temperature")));
  }

  @Test
  void streamingIsEnabledWithUsageOnlyWhereItIsSupported() {
    Map<String, Object> chat = new LinkedHashMap<>();
    Wire.enableStreaming(chat, "chat");
    assertEquals(true, chat.get("stream"));
    assertEquals(Map.of("include_usage", true), chat.get("stream_options"));

    // The Responses API reports usage in its own events and rejects `stream_options`.
    Map<String, Object> responses = new LinkedHashMap<>();
    Wire.enableStreaming(responses, "responses");
    assertEquals(true, responses.get("stream"));
    assertTrue(responses.get("stream_options") == null);
  }
}
