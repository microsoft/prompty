package com.microsoft.prompty.anthropic;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Streams;
import com.microsoft.prompty.VectorAgents;
import com.microsoft.prompty.model.Agent;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Covers Anthropic's schema conversion, which differs from OpenAI's in ways no shared vector reaches.
 *
 * <p>Anthropic takes tools flat rather than nested under a function wrapper, describes structured
 * output through {@code output_config} rather than {@code response_format}, and — unlike OpenAI's
 * strict mode — never widens {@code required} to include optional properties. Each of those is a
 * place a shared implementation would quietly produce the wrong request.
 */
class WireSchemaTest {

  private static Agent agentWith(String key, Object value) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put(key, value);
    return VectorAgents.buildAgent(input, "claude-3", "anthropic");
  }

  private static Map<String, Object> toolSchema(Object tools) {
    List<Object> wire = Wire.toolsToWire(agentWith("tools", tools));
    Map<?, ?> tool = assertInstanceOf(Map.class, wire.get(0));
    return castSchema(tool.get("input_schema"));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> castSchema(Object node) {
    return (Map<String, Object>) assertInstanceOf(Map.class, node);
  }

  @Test
  void toolsAreFlatRatherThanNestedUnderAFunctionWrapper() {
    List<Object> wire =
        Wire.toolsToWire(
            agentWith(
                "tools",
                List.of(
                    Map.of(
                        "name",
                        "get_weather",
                        "kind",
                        "function",
                        "description",
                        "Look up the weather"))));

    Map<?, ?> tool = assertInstanceOf(Map.class, wire.get(0));
    assertEquals("get_weather", tool.get("name"));
    assertEquals("Look up the weather", tool.get("description"));
    // OpenAI would wrap this as {type:"function", function:{...}}; Anthropic must not.
    assertNull(tool.get("type"));
    assertNull(tool.get("function"));
    assertTrue(tool.containsKey("input_schema"));
  }

  @Test
  void onlyGenuinelyRequiredParametersAreListedAsRequired() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "search",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of("name", "query", "kind", "string", "required", true),
                        Map.of("name", "limit", "kind", "integer")))));

    // OpenAI's strict mode requires listing every property and marking the optional ones nullable.
    // Anthropic has no such rule, so widening `required` here would misdescribe the tool.
    assertEquals(List.of("query"), schema.get("required"));
  }

  @Test
  void aToolWithNoRequiredParametersOmitsTheRequiredKeyEntirely() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "ping",
                    "kind",
                    "function",
                    "parameters",
                    List.of(Map.of("name", "note", "kind", "string")))));

    assertFalse(schema.containsKey("required"), "an empty required list should not be sent");
  }

  @Test
  void nestedObjectsCarryTheirOwnRequiredListAndRejectExtraProperties() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "book",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of(
                            "name",
                            "trip",
                            "kind",
                            "object",
                            "required",
                            true,
                            "properties",
                            List.of(
                                Map.of("name", "city", "kind", "string", "required", true),
                                Map.of("name", "hotel", "kind", "string")))))));

    Object nested = Streams.pointer(schema, "properties", "trip");
    assertEquals(List.of("city"), castSchema(nested).get("required"));
    assertEquals(false, castSchema(nested).get("additionalProperties"));
  }

  @Test
  void boundParametersAreHiddenFromTheModel() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "search",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of("name", "query", "kind", "string", "required", true),
                        Map.of("name", "api_key", "kind", "string", "required", true)),
                    "bindings",
                    List.of(Map.of("name", "api_key", "input", "secret")))));

    // A bound parameter is supplied by the host, so offering it to the model invites an argument
    // about a value the model cannot influence.
    Map<String, Object> properties = castSchema(schema.get("properties"));
    assertTrue(properties.containsKey("query"));
    assertFalse(properties.containsKey("api_key"));
    assertEquals(List.of("query"), schema.get("required"));
  }

  @Test
  void aNonFunctionToolStillGetsAnEmptyObjectSchema() {
    List<Object> wire =
        Wire.toolsToWire(
            agentWith(
                "tools",
                List.of(
                    Map.of(
                        "name",
                        "web_search",
                        "kind",
                        "mcp",
                        "serverName",
                        "search-server",
                        "connection",
                        Map.of("kind", "reference")))));

    Map<String, Object> schema = castSchema(assertInstanceOf(Map.class, wire.get(0)).get("input_schema"));
    assertEquals("object", schema.get("type"));
    assertEquals(Map.of(), schema.get("properties"));
  }

  @Test
  void nullablePropertiesWidenTheirTypeRatherThanBeingDropped() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "note",
                    "kind",
                    "function",
                    "parameters",
                    List.of(Map.of("name", "body", "kind", "string", "nullable", true)))));

    Object body = Streams.pointer(schema, "properties", "body");
    assertEquals(List.of("string", "null"), castSchema(body).get("type"));
  }

  @Test
  void aNullableEnumGainsNullAsAPermittedValue() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "note",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of(
                            "name",
                            "level",
                            "kind",
                            "string",
                            "nullable",
                            true,
                            "enumValues",
                            List.of("low", "high"))))));

    Object level = Streams.pointer(schema, "properties", "level");
    // Widening only `type` would leave an enum that still rejects null, so the schema would
    // contradict the declaration it came from.
    assertEquals(List.of("string", "null"), castSchema(level).get("type"));
    List<?> values = assertInstanceOf(List.class, castSchema(level).get("enum"));
    assertEquals(java.util.Arrays.asList("low", "high", null), values);
  }

  @Test
  void aNullableUnionGainsANullBranchRatherThanANullType() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "note",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of(
                            "name",
                            "value",
                            "kind",
                            "union",
                            "nullable",
                            true,
                            "anyOf",
                            List.of(
                                Map.of("name", "a", "kind", "string"),
                                Map.of("name", "b", "kind", "integer")))))));

    Object value = Streams.pointer(schema, "properties", "value");
    // A union has no single `type` to widen, so null has to become another alternative.
    assertNull(castSchema(value).get("type"));
    List<?> branches = assertInstanceOf(List.class, castSchema(value).get("anyOf"));
    assertEquals(3, branches.size());
    assertEquals(Map.of("type", "null"), branches.get(2));
  }

  @Test
  void aNullableObjectIsWrappedSoItsOwnConstraintsSurvive() {
    Map<String, Object> schema =
        toolSchema(
            List.of(
                Map.of(
                    "name",
                    "note",
                    "kind",
                    "function",
                    "parameters",
                    List.of(
                        Map.of(
                            "name",
                            "who",
                            "kind",
                            "object",
                            "nullable",
                            true,
                            "properties",
                            List.of(Map.of("name", "id", "kind", "string")))))));

    Map<String, Object> who = castSchema(Streams.pointer(schema, "properties", "who"));
    assertEquals(List.of("object", "null"), who.get("type"));
    // The nested shape has to survive the widening; losing it would accept any object at all.
    assertEquals(
        Map.of("type", "string"), Streams.pointer(who, "properties", "id"));
  }

  @Test
  void structuredOutputUsesOutputConfigRatherThanResponseFormat() {
    Agent agent =
        agentWith(
            "outputs",
            List.of(
                Map.of("name", "answer", "kind", "string", "required", true),
                Map.of("name", "confidence", "kind", "float")));

    Map<String, Object> body = Wire.buildChatArgs(agent, List.of());

    // OpenAI spells this `response_format`; sending that to Anthropic is silently ignored, which
    // would turn a structured-output prompt into a plain one without any error.
    assertNull(body.get("response_format"));
    assertEquals("json_schema", Streams.pointer(body, "output_config", "format", "type"));

    Object schema = Streams.pointer(body, "output_config", "format", "schema");
    assertEquals("object", castSchema(schema).get("type"));
    assertEquals(List.of("answer"), castSchema(schema).get("required"));
    assertEquals(false, castSchema(schema).get("additionalProperties"));
    assertEquals("number", Streams.pointer(schema, "properties", "confidence", "type"));
  }

  @Test
  void aPromptWithNoOutputsSendsNoOutputConfig() {
    assertNull(Wire.buildChatArgs(agentWith("model_id", "claude-3"), List.of()).get("output_config"));
  }

  @Test
  void anAmbiguousUnionIsRejectedRatherThanGuessed() {
    // Both branch sets populated leaves it undecidable which one constrains the model, and picking
    // one would silently change what the model is allowed to return.
    assertThrows(
        SchemaException.class,
        () ->
            toolSchema(
                List.of(
                    Map.of(
                        "name",
                        "choose",
                        "kind",
                        "function",
                        "parameters",
                        List.of(
                            Map.of(
                                "name",
                                "value",
                                "kind",
                                "union",
                                "oneOf",
                                List.of(Map.of("name", "a", "kind", "string")),
                                "anyOf",
                                List.of(Map.of("name", "b", "kind", "integer"))))))));
  }

  @Test
  void maxTokensIsAlwaysSentBecauseAnthropicRequiresIt() {
    Map<String, Object> body = Wire.buildChatArgs(agentWith("model_id", "claude-3"), List.of());
    assertEquals(4096L, ((Number) body.get("max_tokens")).longValue());
  }
}
