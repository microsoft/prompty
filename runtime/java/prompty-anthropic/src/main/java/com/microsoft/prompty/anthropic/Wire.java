package com.microsoft.prompty.anthropic;

import com.microsoft.prompty.model.ArrayProperty;
import com.microsoft.prompty.model.Binding;
import com.microsoft.prompty.model.ContentPart;
import com.microsoft.prompty.model.FilePart;
import com.microsoft.prompty.model.FunctionTool;
import com.microsoft.prompty.model.ImagePart;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelOptions;
import com.microsoft.prompty.model.ObjectProperty;
import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.TextPart;
import com.microsoft.prompty.model.Tool;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.TypraJson;
import com.microsoft.prompty.model.UnionProperty;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Request shaping for the Anthropic Messages API.
 *
 * <p>Anthropic and OpenAI agree on what a conversation is and disagree on almost every detail of how
 * to write one down. System messages leave the message list and become a top-level {@code system}
 * string; content is always an array of typed blocks rather than sometimes a bare string; tools put
 * their schema under {@code input_schema} instead of nesting it inside a {@code function} wrapper;
 * and {@code max_tokens} is mandatory rather than optional. Those differences are the entire reason
 * this class exists separately from the OpenAI one — sharing an abstraction across them would cost
 * more than it saves.
 *
 * <p>Everything here is a pure function of the prompt and its messages, which is what lets the shared
 * wire vectors grade it without a network.
 */
public final class Wire {

  /** Anthropic rejects a request without {@code max_tokens}, so an unset value still needs one. */
  private static final long DEFAULT_MAX_TOKENS = 4096;

  /** The API version this wire format was written against, sent on every request. */
  public static final String ANTHROPIC_VERSION = "2023-06-01";

  private Wire() {}

  // -------------------------------------------------------- request building

  /** Build the request body for {@code POST /v1/messages}. */
  public static Map<String, Object> buildChatArgs(Prompty agent, List<Message> messages) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", modelId(agent));

    String system = extractSystem(messages);
    if (!system.isEmpty()) {
      body.put("system", system);
    }

    List<Object> wireMessages = new ArrayList<>();
    for (Message message : messages) {
      if (!isSystem(message)) {
        wireMessages.add(messageToWire(message));
      }
    }
    body.put("messages", wireMessages);

    applyOptions(agent, body);

    List<Object> tools = toolsToWire(agent);
    if (!tools.isEmpty()) {
      body.put("tools", tools);
    }

    Map<String, Object> outputConfig = outputConfigToWire(agent);
    if (outputConfig != null) {
      body.put("output_config", outputConfig);
    }

    return body;
  }

  /** Mark a request body as streaming. */
  public static void enableStreaming(Map<String, Object> body) {
    body.put("stream", true);
  }

  private static String modelId(Prompty agent) {
    if (agent != null && agent.model != null && agent.model.id != null && !agent.model.id.isEmpty()) {
      return agent.model.id;
    }
    return "";
  }

  // -------------------------------------------------------- messages

  private static boolean isSystem(Message message) {
    return message != null && (message.role == Role.SYSTEM || message.role == Role.DEVELOPER);
  }

  /**
   * Collect every system message into the single string Anthropic expects.
   *
   * <p>Blank-line joining keeps separately authored instructions from running together, which is what
   * they would otherwise do once the message boundaries are gone.
   */
  private static String extractSystem(List<Message> messages) {
    List<String> blocks = new ArrayList<>();
    for (Message message : messages) {
      if (isSystem(message)) {
        blocks.add(textOf(message));
      }
    }
    return String.join("\n\n", blocks);
  }

  private static String textOf(Message message) {
    StringBuilder text = new StringBuilder();
    if (message != null && message.parts != null) {
      for (ContentPart part : message.parts) {
        if (part instanceof TextPart textPart && textPart.value != null) {
          text.append(textPart.value);
        }
      }
    }
    return text.toString();
  }

  /**
   * Convert one message to its wire form.
   *
   * <p>Three metadata keys change the shape entirely, because each records something the parts list
   * cannot: {@code tool_results} carries a whole batch of results, {@code tool_use_id} identifies a
   * single one, and {@code content} preserves the exact blocks a previous assistant turn produced.
   * That last one matters most — Anthropic wants an assistant turn replayed verbatim, including
   * thinking blocks and their signatures, and reconstructing it from text would lose them.
   */
  public static Map<String, Object> messageToWire(Message message) {
    Map<String, Object> wire = new LinkedHashMap<>();
    wire.put("role", roleName(message));

    Map<String, Object> metadata = metadataOf(message);

    Object batched = metadata.get("tool_results");
    if (batched != null) {
      wire.put("content", batched);
      return wire;
    }

    Object toolUseId = metadata.get("tool_use_id");
    if (toolUseId instanceof String id) {
      // Present-but-empty still means "this is a tool result". Reinterpreting it as ordinary content
      // would lose the framing and could produce a confusing success; forwarding it earns a clear
      // rejection from the API instead.
      Map<String, Object> block = new LinkedHashMap<>();
      block.put("type", "tool_result");
      block.put("tool_use_id", id);
      block.put("content", textOf(message));
      wire.put("content", List.of(block));
      return wire;
    }

    Object raw = metadata.get("content");
    if (raw != null) {
      wire.put("content", raw);
      return wire;
    }

    List<Object> blocks = new ArrayList<>();
    if (message != null && message.parts != null) {
      for (ContentPart part : message.parts) {
        blocks.add(partToWire(part));
      }
    }
    wire.put("content", blocks);
    return wire;
  }

  /**
   * Anthropic recognises only {@code user} and {@code assistant}.
   *
   * <p>Tool results arrive as user turns, which is how the API models them: the tool is something the
   * caller ran on the model's behalf, so its output is the caller speaking.
   */
  private static String roleName(Message message) {
    if (message == null || message.role == null) {
      return "user";
    }
    return message.role == Role.ASSISTANT ? "assistant" : "user";
  }

  private static Map<String, Object> partToWire(ContentPart part) {
    Map<String, Object> block = new LinkedHashMap<>();
    if (part instanceof TextPart text) {
      block.put("type", "text");
      block.put("text", text.value == null ? "" : text.value);
      return block;
    }
    if (part instanceof ImagePart image) {
      String source = image.source == null ? "" : image.source;
      block.put("type", "image");
      Map<String, Object> descriptor = new LinkedHashMap<>();
      if (source.startsWith("http://") || source.startsWith("https://")) {
        descriptor.put("type", "url");
        descriptor.put("url", source);
      } else {
        descriptor.put("type", "base64");
        // Only an unset media type is defaulted. Guessing a type the caller explicitly blanked out
        // risks labelling the bytes wrongly, which produces a garbled image rather than an error.
        descriptor.put("media_type", image.mediaType == null ? "image/png" : image.mediaType);
        descriptor.put("data", source);
      }
      block.put("source", descriptor);
      return block;
    }
    // Anthropic accepts neither audio nor documents on this endpoint. A placeholder keeps the turn
    // structurally valid and tells the model something was there, which silently dropping would not.
    block.put("type", "text");
    block.put(
        "text",
        part instanceof FilePart
            ? "[file content not supported by Anthropic]"
            : "[audio content not supported by Anthropic]");
    return block;
  }

  // -------------------------------------------------------- options

  private static ModelOptions options(Prompty agent) {
    return agent == null || agent.model == null ? null : agent.model.options;
  }

  /**
   * Copy model options onto the body, then guarantee {@code max_tokens}.
   *
   * <p>The per-provider option names come from the generated model rather than a table kept here, so
   * a schema change reaches every runtime at once instead of drifting between them.
   */
  private static void applyOptions(Prompty agent, Map<String, Object> body) {
    long maxTokens = DEFAULT_MAX_TOKENS;
    ModelOptions options = options(agent);

    if (options != null) {
      Map<String, Object> wire = options.toWire("anthropic");
      if (wire != null) {
        for (Map.Entry<String, Object> entry : wire.entrySet()) {
          if (entry.getValue() == null) {
            continue;
          }
          if ("max_tokens".equals(entry.getKey())) {
            if (entry.getValue() instanceof Number number) {
              maxTokens = number.longValue();
            }
          } else {
            body.put(entry.getKey(), narrowFloat(entry.getValue()));
          }
        }
      }
      if (options.additionalProperties instanceof Map<?, ?> extra) {
        for (Map.Entry<?, ?> entry : extra.entrySet()) {
          String key = String.valueOf(entry.getKey());
          if (!body.containsKey(key)) {
            body.put(key, entry.getValue());
          }
        }
      }
    }

    body.put("max_tokens", maxTokens);
  }

  /**
   * Round a float back through its own shortest decimal form.
   *
   * <p>Widening a {@code float} to {@code double} exposes the binary approximation, so a temperature
   * authored as 0.7 would otherwise reach the provider as 0.699999988079071.
   */
  private static Object narrowFloat(Object value) {
    if (value instanceof Float number) {
      return Double.parseDouble(Float.toString(number));
    }
    return value;
  }

  // -------------------------------------------------------- tools

  /** Convert declared function tools to Anthropic's flat tool definitions. */
  public static List<Object> toolsToWire(Prompty agent) {
    List<Object> wire = new ArrayList<>();
    if (agent == null || agent.tools == null) {
      return wire;
    }
    for (Tool tool : agent.tools) {
      wire.add(toolToWire(tool));
    }
    return wire;
  }

  private static Map<String, Object> toolToWire(Tool tool) {
    Map<String, Object> wire = new LinkedHashMap<>();
    wire.put("name", tool.name == null ? "" : tool.name);
    if (tool.description != null && !tool.description.isEmpty()) {
      wire.put("description", tool.description);
    }

    if (tool instanceof FunctionTool function) {
      wire.put("input_schema", parametersToJsonSchema(unboundParameters(function)));
    } else {
      // A non-function tool is something the provider resolves itself; it still needs a schema slot,
      // and an empty object is the honest description of "takes nothing we know about".
      Map<String, Object> empty = new LinkedHashMap<>();
      empty.put("type", "object");
      empty.put("properties", new LinkedHashMap<String, Object>());
      wire.put("input_schema", empty);
    }
    return wire;
  }

  /**
   * The parameters the model is expected to supply.
   *
   * <p>A bound parameter is filled in by the host, so exposing it would invite the model to argue
   * with a value it cannot influence.
   */
  private static List<Property> unboundParameters(FunctionTool tool) {
    List<Property> parameters = tool.parameters == null ? List.of() : tool.parameters;
    Set<String> bound = new LinkedHashSet<>();
    if (tool.bindings != null) {
      for (Binding binding : tool.bindings) {
        if (binding != null && binding.name != null) {
          bound.add(binding.name);
        }
      }
    }
    if (bound.isEmpty()) {
      return parameters;
    }
    List<Property> unbound = new ArrayList<>();
    for (Property parameter : parameters) {
      if (parameter != null && !bound.contains(parameter.name)) {
        unbound.add(parameter);
      }
    }
    return unbound;
  }

  private static Map<String, Object> parametersToJsonSchema(List<Property> parameters) {
    Map<String, Object> properties = new LinkedHashMap<>();
    List<Object> required = new ArrayList<>();
    for (Property parameter : parameters) {
      if (parameter == null || parameter.name == null || parameter.name.isEmpty()) {
        continue;
      }
      properties.put(parameter.name, propertySchema(parameter));
      if (Boolean.TRUE.equals(parameter.required)) {
        required.add(parameter.name);
      }
    }

    Map<String, Object> schema = new LinkedHashMap<>();
    schema.put("type", "object");
    schema.put("properties", properties);
    if (!required.isEmpty()) {
      schema.put("required", required);
    }
    return schema;
  }

  // -------------------------------------------------------- schemas

  /** Convert one portable property into JSON Schema. */
  private static Map<String, Object> propertySchema(Property property) {
    Map<String, Object> schema = new LinkedHashMap<>();

    String jsonType = kindToJsonType(property.kind);
    if (jsonType != null) {
      schema.put("type", jsonType);
    }
    if (property.description != null && !property.description.isEmpty()) {
      schema.put("description", property.description);
    }
    if (property.enumValues != null && !property.enumValues.isEmpty()) {
      schema.put("enum", new ArrayList<Object>(property.enumValues));
    }

    if (property instanceof ArrayProperty array) {
      // An array with no declared element type still needs one, and a string is the only guess that
      // never makes the schema stricter than the author intended.
      schema.put(
          "items", array.items == null ? Map.of("type", "string") : propertySchema(array.items));
    } else if (property instanceof ObjectProperty object) {
      Map<String, Object> nested = new LinkedHashMap<>();
      List<Object> required = new ArrayList<>();
      if (object.properties != null) {
        for (Property member : object.properties) {
          if (member == null || member.name == null || member.name.isEmpty()) {
            continue;
          }
          nested.put(member.name, propertySchema(member));
          if (Boolean.TRUE.equals(member.required)) {
            required.add(member.name);
          }
        }
      }
      schema.put("properties", nested);
      if (!required.isEmpty()) {
        schema.put("required", required);
      }
      schema.put("additionalProperties", false);
    } else if (property instanceof UnionProperty union) {
      boolean hasOneOf = union.oneOf != null && !union.oneOf.isEmpty();
      boolean hasAnyOf = union.anyOf != null && !union.anyOf.isEmpty();
      if (hasOneOf == hasAnyOf) {
        // Both or neither leaves the branch set ambiguous, and guessing one would silently change
        // what the model is allowed to return.
        throw new SchemaException(
            "UnionProperty must contain exactly one non-empty `oneOf` or `anyOf` array");
      }
      List<Object> branches = new ArrayList<>();
      for (Property branch : hasOneOf ? union.oneOf : union.anyOf) {
        branches.add(propertySchema(branch));
      }
      schema.put(hasOneOf ? "oneOf" : "anyOf", branches);
    }

    if (Boolean.TRUE.equals(property.nullable)) {
      addNullability(schema);
    }
    return schema;
  }

  /**
   * Widen a schema so null is a legal value.
   *
   * <p>JSON Schema has four ways to say this depending on what the schema already is, and picking the
   * wrong one produces a schema that validates nothing.
   */
  private static void addNullability(Map<String, Object> schema) {
    Object type = schema.get("type");
    if (type instanceof String single) {
      // Re-inserting at the head keeps `type` first, which matters only for readability.
      Map<String, Object> reordered = new LinkedHashMap<>();
      reordered.put("type", new ArrayList<Object>(List.of(single, "null")));
      for (Map.Entry<String, Object> entry : schema.entrySet()) {
        if (!"type".equals(entry.getKey())) {
          reordered.put(entry.getKey(), entry.getValue());
        }
      }
      schema.clear();
      schema.putAll(reordered);
    } else if (schema.get("anyOf") instanceof List<?> anyOf) {
      List<Object> branches = new ArrayList<>(anyOf);
      branches.add(Map.of("type", "null"));
      schema.put("anyOf", branches);
    } else if (schema.get("oneOf") instanceof List<?> oneOf) {
      List<Object> branches = new ArrayList<>(oneOf);
      branches.add(Map.of("type", "null"));
      schema.put("oneOf", branches);
    } else if (!schema.isEmpty()) {
      // Deliberately unlike the reference implementation, which inserts `anyOf` while leaving the
      // original keys in place, yielding a schema that repeats its own constraints inside one of
      // its branches. Both accept the same values; replacing is the shape a reader can follow.
      // Only reachable for a property whose kind maps to no JSON type, so no vector grades it.
      Map<String, Object> wrapped = new LinkedHashMap<>(schema);
      schema.clear();
      schema.put("anyOf", new ArrayList<Object>(List.of(wrapped, Map.of("type", "null"))));
    }

    if (schema.get("enum") instanceof List<?> values) {
      List<Object> widened = new ArrayList<>(values);
      if (!widened.contains(null)) {
        widened.add(null);
      }
      schema.put("enum", widened);
    }
  }

  private static String kindToJsonType(String kind) {
    if (kind == null) {
      return null;
    }
    return switch (kind) {
      case "string" -> "string";
      case "integer" -> "integer";
      case "float", "number" -> "number";
      case "boolean" -> "boolean";
      case "array" -> "array";
      case "object" -> "object";
      default -> null;
    };
  }

  // -------------------------------------------------------- structured output

  /** Convert declared outputs into Anthropic's {@code output_config}, or null when there are none. */
  private static Map<String, Object> outputConfigToWire(Prompty agent) {
    if (agent == null || agent.outputs == null || agent.outputs.isEmpty()) {
      return null;
    }

    Map<String, Object> properties = new LinkedHashMap<>();
    List<Object> required = new ArrayList<>();
    for (Property output : agent.outputs) {
      if (output == null || output.name == null || output.name.isEmpty()) {
        continue;
      }
      properties.put(output.name, propertySchema(output));
      if (Boolean.TRUE.equals(output.required)) {
        required.add(output.name);
      }
    }

    Map<String, Object> schema = new LinkedHashMap<>();
    schema.put("type", "object");
    schema.put("properties", properties);
    if (!required.isEmpty()) {
      schema.put("required", required);
    }
    schema.put("additionalProperties", false);

    Map<String, Object> format = new LinkedHashMap<>();
    format.put("type", "json_schema");
    format.put("schema", schema);
    return Map.of("format", format);
  }

  // -------------------------------------------------------- agent loop

  /**
   * Replay a completed round of tool calls as conversation messages.
   *
   * <p>Two messages, always: the assistant turn that requested the calls, carrying its original
   * content blocks so thinking signatures survive the round trip, then a single user turn holding
   * every result. Anthropic batches results into one message rather than one message per result,
   * which is the opposite of OpenAI and the reason this cannot be shared.
   */
  public static List<Message> formatToolMessages(
      Object rawResponse, List<ToolCall> toolCalls, List<String> toolResults) {
    List<Message> messages = new ArrayList<>();

    Object blocks = rawResponse instanceof Map<?, ?> map ? map.get("content") : null;
    Message assistant = com.microsoft.prompty.Messages.assistant("");
    // Deep-copied, not aliased: the metadata outlives the response object, so sharing any node of
    // it would let a caller that reuses or mutates the response rewrite a message already sent.
    com.microsoft.prompty.Messages.metadata(assistant)
        .put(
            "content",
            blocks instanceof List<?> list
                ? com.microsoft.prompty.Streams.deepCopy(list)
                : new ArrayList<>());
    messages.add(assistant);

    List<Object> results = new ArrayList<>();
    for (int i = 0; i < toolCalls.size(); i++) {
      ToolCall call = toolCalls.get(i);
      // Every requested call needs an answer or the next request is rejected, so a missing result
      // becomes an empty one rather than a gap.
      String result = i < toolResults.size() ? toolResults.get(i) : "";
      Map<String, Object> block = new LinkedHashMap<>();
      block.put("type", "tool_result");
      block.put("tool_use_id", call.id);
      block.put("content", result);
      results.add(block);
    }

    Message user = com.microsoft.prompty.Messages.user("");
    com.microsoft.prompty.Messages.metadata(user).put("tool_results", results);
    messages.add(user);

    return messages;
  }

  /**
   * Rebuild the assistant turn from streamed events, then replay it with its tool results.
   *
   * <p>A streamed response never arrives as one object, so the content blocks have to be reassembled
   * from their start events and deltas before they can be echoed back. Doing this faithfully is what
   * lets a streamed tool round continue as if it had never been streamed.
   */
  public static List<Message> formatStreamToolMessages(
      List<Object> rawChunks,
      List<ToolCall> toolCalls,
      List<String> toolResults,
      String textContent) {
    Map<Integer, Map<String, Object>> blocks = new TreeMap<>();
    Map<Integer, StringBuilder> partialInputs = new TreeMap<>();

    for (Object event : rawChunks == null ? List.of() : rawChunks) {
      int index = intAt(event, "index");
      String type = stringAt(event, "type");
      if ("content_block_start".equals(type)) {
        Object block = com.microsoft.prompty.Streams.pointer(event, "content_block");
        if (block instanceof Map<?, ?> map) {
          blocks.put(index, copyOf(map));
        }
        continue;
      }
      if (!"content_block_delta".equals(type)) {
        continue;
      }
      Object delta = com.microsoft.prompty.Streams.pointer(event, "delta");
      if (delta == null) {
        continue;
      }
      switch (String.valueOf(stringAt(delta, "type"))) {
        case "text_delta" ->
            appendTo(blocks, index, "text", stringAt(delta, "text"), seed("text", "text"));
        case "thinking_delta" ->
            appendTo(
                blocks, index, "thinking", stringAt(delta, "thinking"), seed("thinking", "thinking"));
        case "signature_delta" ->
            appendTo(
                blocks,
                index,
                "signature",
                stringAt(delta, "signature"),
                // A thinking block is only valid with its `thinking` field present, so a signature
                // arriving before any thinking text still has to seed one.
                seed("thinking", "thinking", "signature"));
        case "input_json_delta" ->
            partialInputs
                .computeIfAbsent(index, key -> new StringBuilder())
                .append(orEmpty(stringAt(delta, "partial_json")));
        default -> {}
      }
    }

    for (Map.Entry<Integer, StringBuilder> entry : partialInputs.entrySet()) {
      Map<String, Object> block = blocks.get(entry.getKey());
      if (block != null && entry.getValue().length() > 0) {
        block.put("input", parseOrEmpty(entry.getValue().toString()));
      }
    }

    if (blocks.isEmpty()) {
      // No raw events survived — a replayed or synthesised stream. The accumulated text and tool
      // calls still describe the turn, so rebuild it from those rather than sending an empty one.
      int index = 0;
      if (textContent != null && !textContent.isEmpty()) {
        Map<String, Object> text = new LinkedHashMap<>();
        text.put("type", "text");
        text.put("text", textContent);
        blocks.put(index++, text);
      }
      for (ToolCall call : toolCalls) {
        Map<String, Object> use = new LinkedHashMap<>();
        use.put("type", "tool_use");
        use.put("id", call.id);
        use.put("name", call.name);
        use.put("input", parseOrEmpty(call.arguments));
        blocks.put(index++, use);
      }
    }

    Map<String, Object> response = Map.of("content", new ArrayList<Object>(blocks.values()));
    return formatToolMessages(response, toolCalls, toolResults);
  }

  /**
   * A freshly seeded content block of the given type, with each named field present but empty.
   *
   * <p>A block has to be structurally complete even when only one of its fields ever receives a
   * delta, because Anthropic rejects a thinking block that arrives without its {@code thinking}
   * field on the replay.
   */
  private static Map<String, Object> seed(String type, String... fields) {
    Map<String, Object> block = new LinkedHashMap<>();
    block.put("type", type);
    for (String field : fields) {
      block.put(field, "");
    }
    return block;
  }

  private static void appendTo(
      Map<Integer, Map<String, Object>> blocks,
      int index,
      String field,
      String addition,
      Map<String, Object> seed) {
    Map<String, Object> block = blocks.computeIfAbsent(index, key -> new LinkedHashMap<>(seed));
    Object current = block.get(field);
    block.put(field, (current instanceof String text ? text : "") + orEmpty(addition));
  }

  private static Map<String, Object> copyOf(Map<?, ?> map) {
    Map<String, Object> copy = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : map.entrySet()) {
      copy.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return copy;
  }

  private static Object parseOrEmpty(String json) {
    if (json == null || json.isEmpty()) {
      return new LinkedHashMap<String, Object>();
    }
    try {
      return TypraJson.parse(json);
    } catch (RuntimeException e) {
      // Truncated or malformed arguments are the model's problem to have made, not ours to raise;
      // an empty object keeps the replayed turn well-formed.
      return new LinkedHashMap<String, Object>();
    }
  }

  private static Map<String, Object> metadataOf(Message message) {
    if (message == null || message.metadata == null) {
      return Map.of();
    }
    return message.metadata;
  }

  private static String stringAt(Object node, String key) {
    Object value = com.microsoft.prompty.Streams.pointer(node, key);
    return value instanceof String text ? text : null;
  }

  private static String orEmpty(String value) {
    return value == null ? "" : value;
  }

  private static int intAt(Object node, String key) {
    Object value = com.microsoft.prompty.Streams.pointer(node, key);
    return value instanceof Number number ? number.intValue() : 0;
  }

  /** Exposed so the processor can share one notion of "these are the text blocks". */
  static String joinText(Collection<?> blocks) {
    StringBuilder text = new StringBuilder();
    for (Object block : blocks) {
      if ("text".equals(stringAt(block, "type"))) {
        text.append(orEmpty(stringAt(block, "text")));
      }
    }
    return text.toString();
  }
}
