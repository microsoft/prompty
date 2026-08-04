package com.microsoft.prompty.openai;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.ArrayProperty;
import com.microsoft.prompty.model.AudioPart;
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
import com.microsoft.prompty.model.TextPart;
import com.microsoft.prompty.model.Tool;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.TypraJson;
import com.microsoft.prompty.model.UnionProperty;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Conversion between Prompty's portable types and the JSON bodies the OpenAI APIs expect.
 *
 * <p>Everything here is a pure function of the agent and its messages, with no network or client
 * state, which is what lets the shared {@code spec/vectors/wire} suite grade it directly.
 *
 * <p>Option names are not mapped here. {@link ModelOptions#toWire(String)} is generated from the
 * same TypeSpec every runtime shares, so {@code maxOutputTokens → max_completion_tokens} is decided
 * once in the model rather than re-decided per language.
 */
public final class Wire {

  private Wire() {}

  // ------------------------------------------------------------ messages

  /** Convert a message to the OpenAI chat wire shape. */
  public static Map<String, Object> messageToWire(Message message) {
    Map<String, Object> wire = new LinkedHashMap<>();
    wire.put("role", roleName(message));

    // Metadata carries the fields that live beside content on the wire — tool_call_id, tool_calls,
    // name. Role and content are excluded because they are produced from the message proper.
    for (Map.Entry<String, Object> entry : Messages.metadata(message).entrySet()) {
      if (!"role".equals(entry.getKey()) && !"content".equals(entry.getKey())) {
        wire.put(entry.getKey(), entry.getValue());
      }
    }

    Object content = Messages.toTextContent(message);
    if (content instanceof String) {
      wire.put("content", content);
    } else {
      List<Object> parts = new ArrayList<>();
      if (message.parts != null) {
        for (ContentPart part : message.parts) {
          parts.add(partToWire(part));
        }
      }
      wire.put("content", parts);
    }
    return wire;
  }

  private static String roleName(Message message) {
    return message.role == null ? "user" : message.role.value;
  }

  private static Map<String, Object> partToWire(ContentPart part) {
    if (part instanceof TextPart text) {
      return Map.of("type", "text", "text", text.value == null ? "" : text.value);
    }
    if (part instanceof ImagePart image) {
      Map<String, Object> url = new LinkedHashMap<>();
      url.put("url", image.source);
      if (image.detail != null) {
        url.put("detail", image.detail);
      }
      return Map.of("type", "image_url", "image_url", url);
    }
    if (part instanceof AudioPart audio) {
      Map<String, Object> input = new LinkedHashMap<>();
      input.put("data", audio.source);
      input.put("format", mimeToAudioFormat(audio.mediaType));
      return Map.of("type", "input_audio", "input_audio", input);
    }
    if (part instanceof FilePart file) {
      return Map.of("type", "file", "file", Map.of("url", file.source));
    }
    return Map.of("type", "text", "text", "");
  }

  /** Map an audio MIME type onto the short format name OpenAI expects. */
  static String mimeToAudioFormat(String mime) {
    if (mime == null) {
      return "wav";
    }
    return switch (mime) {
      case "audio/wav", "audio/x-wav" -> "wav";
      case "audio/mpeg", "audio/mp3" -> "mp3";
      case "audio/mp4" -> "mp4";
      case "audio/ogg" -> "ogg";
      case "audio/flac" -> "flac";
      case "audio/webm" -> "webm";
      case "audio/pcm" -> "pcm";
      // Spec §7.1.2: an unmapped audio type falls back to its subtype.
      default -> mime.startsWith("audio/") ? mime.substring("audio/".length()) : "wav";
    };
  }

  // ------------------------------------------------------- request bodies

  /** Build the request body for a chat completions call. */
  public static Map<String, Object> buildChatArgs(Prompty agent, List<Message> messages) {
    Map<String, Object> args = new LinkedHashMap<>();
    args.put("model", modelId(agent, ""));

    List<Object> wireMessages = new ArrayList<>();
    for (Message message : messages) {
      wireMessages.add(messageToWire(message));
    }
    args.put("messages", wireMessages);

    applyOptions(args, options(agent), "openai");

    List<Object> tools = toolsToWire(agent);
    if (!tools.isEmpty()) {
      args.put("tools", tools);
    }

    Map<String, Object> responseFormat = outputSchemaToWire(agent);
    if (responseFormat != null) {
      args.put("response_format", responseFormat);
    }
    return args;
  }

  /**
   * Turn a chat or agent request body into a streaming one.
   *
   * <p>{@code include_usage} is requested so the terminal event carries token counts; without it a
   * streamed call reports no usage at all and cost tracking silently loses those turns. Every
   * provider that speaks the OpenAI wire format shares this helper so their usage reporting cannot
   * drift apart.
   */
  public static void enableStreaming(Map<String, Object> body, String apiType) {
    body.put("stream", true);
    if ("chat".equals(apiType) || "agent".equals(apiType)) {
      body.put("stream_options", Map.of("include_usage", true));
    }
  }

  /** Build the request body for an embedding call. */
  public static Map<String, Object> buildEmbeddingArgs(Prompty agent, List<Message> messages) {
    Map<String, Object> args = new LinkedHashMap<>();
    args.put("model", modelId(agent, "text-embedding-ada-002"));
    args.put("input", extractTextInput(messages));
    applyAdditionalProperties(args, options(agent), true);
    return args;
  }

  /** Build the request body for an image generation call. */
  public static Map<String, Object> buildImageArgs(Prompty agent, List<Message> messages) {
    Object input = extractTextInput(messages);
    String prompt;
    if (input instanceof List<?> items) {
      List<String> texts = new ArrayList<>();
      for (Object item : items) {
        if (item instanceof String text) {
          texts.add(text);
        }
      }
      prompt = String.join(" ", texts);
    } else {
      prompt = input instanceof String text ? text : "";
    }

    Map<String, Object> args = new LinkedHashMap<>();
    args.put("model", modelId(agent, "dall-e-3"));
    args.put("prompt", prompt);
    applyAdditionalProperties(args, options(agent), true);
    return args;
  }

  private static Object extractTextInput(List<Message> messages) {
    List<String> texts = new ArrayList<>();
    for (Message message : messages) {
      String text = Messages.text(message);
      if (text != null && !text.isEmpty()) {
        texts.add(text);
      }
    }
    return texts.size() == 1 ? texts.get(0) : new ArrayList<Object>(texts);
  }

  private static String modelId(Prompty agent, String fallback) {
    String id = agent == null || agent.model == null ? null : agent.model.id;
    return id == null || id.isEmpty() ? fallback : id;
  }

  private static ModelOptions options(Prompty agent) {
    return agent == null || agent.model == null ? null : agent.model.options;
  }

  // ------------------------------------------------------------- options

  private static void applyOptions(
      Map<String, Object> args, ModelOptions options, String provider) {
    if (options == null) {
      return;
    }
    for (Map.Entry<String, Object> entry : options.toWire(provider).entrySet()) {
      if (entry.getValue() != null) {
        args.put(entry.getKey(), narrowFloat(entry.getValue()));
      }
    }
    applyAdditionalProperties(args, options, false);
  }

  /**
   * Merge provider-specific passthrough options.
   *
   * @param overwrite whether a passthrough key may replace one the mapped options already set.
   *     Chat requests keep the mapped value, because a declared option is more specific than a
   *     passthrough; embedding and image requests have no mapped options to defend.
   */
  private static void applyAdditionalProperties(
      Map<String, Object> args, ModelOptions options, boolean overwrite) {
    if (options == null || options.additionalProperties == null) {
      return;
    }
    for (Map.Entry<String, Object> entry : options.additionalProperties.entrySet()) {
      if (overwrite || !args.containsKey(entry.getKey())) {
        args.put(entry.getKey(), entry.getValue());
      }
    }
  }

  /**
   * Render a 32-bit option value as the decimal the author wrote.
   *
   * <p>{@code temperature} is a float in the model, so widening 0.7 to a double exposes the binary
   * approximation as 0.699999988079071. Formatting through {@code Float} and re-parsing recovers
   * the shortest decimal that round-trips, which is what every other runtime puts on the wire.
   */
  private static Object narrowFloat(Object value) {
    if (value instanceof Float floatValue) {
      return Double.parseDouble(Float.toString(floatValue));
    }
    return value;
  }

  // --------------------------------------------------------------- tools

  /** Convert the agent's function tools to OpenAI's nested wire shape. */
  public static List<Object> toolsToWire(Prompty agent) {
    List<Object> wire = new ArrayList<>();
    for (FunctionTool tool : functionTools(agent)) {
      Map<String, Object> definition = functionDefinition(tool, false);
      wire.add(Map.of("type", "function", "function", definition));
    }
    return wire;
  }

  private static List<FunctionTool> functionTools(Prompty agent) {
    List<FunctionTool> functions = new ArrayList<>();
    List<Tool> tools = agent == null ? null : agent.tools;
    if (tools == null) {
      return functions;
    }
    for (Tool tool : tools) {
      if (tool instanceof FunctionTool function) {
        functions.add(function);
      }
    }
    return functions;
  }

  /**
   * Build a function definition body.
   *
   * @param flat whether to emit the Responses API's flat shape, which carries {@code type} beside
   *     the name instead of nesting the definition under a {@code function} key
   */
  private static Map<String, Object> functionDefinition(FunctionTool tool, boolean flat) {
    Map<String, Object> definition = new LinkedHashMap<>();
    if (flat) {
      definition.put("type", "function");
    }
    definition.put("name", tool.name);
    if (tool.description != null) {
      definition.put("description", tool.description);
    }

    boolean strict = Boolean.TRUE.equals(tool.strict);
    Map<String, Object> schema = parametersToJsonSchema(unboundParameters(tool), strict);
    definition.put("parameters", schema);

    if (strict) {
      definition.put("strict", true);
      schema.put("additionalProperties", false);
    }
    return definition;
  }

  /**
   * The parameters the model is allowed to fill in.
   *
   * <p>Spec §7.1.3: a bound parameter is supplied by the caller, so exposing it would invite the
   * model to argue with the binding.
   */
  private static List<Property> unboundParameters(FunctionTool tool) {
    Set<String> bound = new HashSet<>();
    if (tool.bindings != null) {
      for (Binding binding : tool.bindings) {
        bound.add(binding.name);
      }
    }
    List<Property> parameters = new ArrayList<>();
    if (tool.parameters != null) {
      for (Property property : tool.parameters) {
        if (!bound.contains(property.name)) {
          parameters.add(property);
        }
      }
    }
    return parameters;
  }

  // -------------------------------------------------------- JSON Schema

  private static Map<String, Object> parametersToJsonSchema(
      List<Property> parameters, boolean strict) {
    Map<String, Object> properties = new LinkedHashMap<>();
    List<Object> required = new ArrayList<>();

    for (Property parameter : parameters) {
      boolean isRequired = Boolean.TRUE.equals(parameter.required);
      properties.put(parameter.name, propertySchema(parameter, !isRequired, strict));
      // Strict mode requires every key to be listed; optionality is expressed by nullability
      // instead, which is the shape OpenAI documents for structured outputs.
      if (strict || isRequired) {
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

  private static Map<String, Object> propertySchema(
      Property property, boolean optional, boolean strict) {
    Map<String, Object> schema = propertySchema(property, strict);
    if (strict && optional && !Boolean.TRUE.equals(property.nullable)) {
      addNullability(schema);
    }
    return schema;
  }

  private static Map<String, Object> propertySchema(Property property, boolean strict) {
    Map<String, Object> schema = new LinkedHashMap<>();
    String jsonType = kindToJsonType(property.kind);
    if (jsonType != null) {
      schema.put("type", jsonType);
    }
    if (property.description != null) {
      schema.put("description", property.description);
    }
    if (property.enumValues != null) {
      schema.put("enum", new ArrayList<Object>(property.enumValues));
    }

    if (property instanceof ArrayProperty array) {
      if (array.items != null) {
        schema.put("items", propertySchema(array.items, strict));
      }
    } else if (property instanceof ObjectProperty object) {
      if (object.properties != null && !object.properties.isEmpty()) {
        Map<String, Object> nested = new LinkedHashMap<>();
        List<Object> required = new ArrayList<>();
        for (Property child : object.properties) {
          if (child.name == null || child.name.isEmpty()) {
            continue;
          }
          boolean isRequired = Boolean.TRUE.equals(child.required);
          nested.put(child.name, propertySchema(child, !isRequired, strict));
          // Strict mode applies at every depth, not just the top level: OpenAI rejects a schema
          // whose nested object omits a key from `required`. Optionality survives as nullability,
          // added by the sibling overload above, so `border` becomes ["string", "null"] rather
          // than disappearing from the list.
          if (strict || isRequired) {
            required.add(child.name);
          }
        }
        schema.put("properties", nested);
        if (!required.isEmpty()) {
          schema.put("required", required);
        }
        schema.put("additionalProperties", false);
      }
    } else if (property instanceof UnionProperty union) {
      boolean hasOneOf = union.oneOf != null && !union.oneOf.isEmpty();
      boolean hasAnyOf = union.anyOf != null && !union.anyOf.isEmpty();
      if (hasOneOf && !hasAnyOf) {
        throw SchemaException.unsupportedOneOf();
      }
      if (!hasAnyOf || hasOneOf) {
        throw SchemaException.invalidUnion();
      }
      List<Object> branches = new ArrayList<>();
      for (Property branch : union.anyOf) {
        branches.add(propertySchema(branch, strict));
      }
      schema.put("anyOf", branches);
    }

    if (Boolean.TRUE.equals(property.nullable)) {
      addNullability(schema);
    }
    return schema;
  }

  /**
   * Widen a schema to admit null.
   *
   * <p>Which form that takes depends on what the schema already says: a plain type becomes a type
   * union, an existing {@code anyOf} gains a null branch, and anything else is wrapped. An empty
   * schema is left alone — it already admits null, and {@code {"anyOf": [{}, {"type": "null"}]}}
   * would only be noise.
   */
  private static void addNullability(Map<String, Object> schema) {
    Object type = schema.get("type");
    if (type instanceof String typeName) {
      schema.remove("type");
      Map<String, Object> reordered = new LinkedHashMap<>(schema);
      schema.clear();
      schema.put("type", List.of(typeName, "null"));
      schema.putAll(reordered);
    } else if (schema.get("anyOf") instanceof List<?> branches) {
      List<Object> widened = new ArrayList<>(branches);
      widened.add(Map.of("type", "null"));
      schema.put("anyOf", widened);
    } else if (!schema.isEmpty()) {
      Map<String, Object> inner = new LinkedHashMap<>(schema);
      schema.clear();
      schema.put("anyOf", List.of(inner, Map.of("type", "null")));
    }

    if (schema.get("enum") instanceof List<?> values && !values.contains(null)) {
      List<Object> widened = new ArrayList<>(values);
      widened.add(null);
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

  // -------------------------------------------------- structured output

  private static Map<String, Object> outputSchemaToWire(Prompty agent) {
    Map<String, Object> schema = outputObjectSchema(agent);
    if (schema == null) {
      return null;
    }
    return Map.of(
        "type",
        "json_schema",
        "json_schema",
        Map.of("name", "structured_output", "strict", true, "schema", schema));
  }

  private static Map<String, Object> outputObjectSchema(Prompty agent) {
    List<Property> outputs = agent == null ? null : agent.outputs;
    if (outputs == null || outputs.isEmpty()) {
      return null;
    }

    Map<String, Object> properties = new LinkedHashMap<>();
    List<Object> required = new ArrayList<>();
    for (Property output : outputs) {
      properties.put(
          output.name, propertySchema(output, !Boolean.TRUE.equals(output.required), true));
      required.add(output.name);
    }

    Map<String, Object> schema = new LinkedHashMap<>();
    schema.put("type", "object");
    schema.put("properties", properties);
    if (!required.isEmpty()) {
      schema.put("required", required);
    }
    schema.put("additionalProperties", false);
    return schema;
  }

  // ------------------------------------------------------- Responses API

  /**
   * Build the request body for the Responses API.
   *
   * <p>System and developer turns are lifted out of the conversation into {@code instructions},
   * which is where that API expects them; everything else becomes an input item.
   */
  public static Map<String, Object> buildResponsesArgs(Prompty agent, List<Message> messages) {
    List<String> instructions = new ArrayList<>();
    List<Object> input = new ArrayList<>();

    for (Message message : messages) {
      String role = roleName(message);
      if ("system".equals(role) || "developer".equals(role)) {
        instructions.add(Messages.text(message));
      } else {
        input.add(messageToResponsesInput(message));
      }
    }

    Map<String, Object> args = new LinkedHashMap<>();
    args.put("model", modelId(agent, "gpt-4o"));
    args.put("input", input);
    if (!instructions.isEmpty()) {
      args.put("instructions", String.join("\n\n", instructions));
    }

    applyOptions(args, options(agent), "responses");

    List<Object> tools = new ArrayList<>();
    for (FunctionTool tool : functionTools(agent)) {
      tools.add(functionDefinition(tool, true));
    }
    if (!tools.isEmpty()) {
      args.put("tools", tools);
    }

    Map<String, Object> schema = outputObjectSchema(agent);
    if (schema != null) {
      args.put(
          "text",
          Map.of(
              "format",
              Map.of(
                  "type", "json_schema",
                  "name", "structured_output",
                  "schema", schema,
                  "strict", true)));
    }
    return args;
  }

  private static Object messageToResponsesInput(Message message) {
    Map<String, Object> metadata = Messages.metadata(message);

    // A function call the provider already owns is replayed verbatim; re-deriving it would lose
    // the identifiers the provider matches its own output against.
    Object functionCall = metadata.get("responses_function_call");
    if (functionCall != null) {
      return functionCall;
    }

    Object content = Messages.toTextContent(message);
    Object callId = metadata.get(Messages.TOOL_CALL_ID);
    if (callId != null) {
      String output = content instanceof String text ? text : TypraJson.stringify(content);
      return Map.of("type", "function_call_output", "call_id", callId, "output", output);
    }

    String role = roleName(message);
    Map<String, Object> item = new LinkedHashMap<>();
    // The Responses API has no tool role; a tool turn that is not a function_call_output is
    // ordinary caller-supplied text.
    item.put("role", "tool".equals(role) ? "user" : role);
    item.put("content", content);
    return item;
  }

  /** Whether a durable message holds a provider-owned Responses function-call item. */
  public static boolean isResponsesFunctionCall(Message message) {
    return Messages.metadata(message).get("responses_function_call") != null;
  }

  // -------------------------------------------------------- agent loop

  /**
   * Render a completed round of tool calls back into conversation messages.
   *
   * <p>One assistant message recording what was called, then one tool message per result — the
   * order OpenAI requires, and the order a replayed conversation has to reproduce.
   */
  public static List<Message> formatToolMessages(List<ToolCall> toolCalls, List<String> results) {
    List<Message> messages = new ArrayList<>();

    List<Object> wireCalls = new ArrayList<>();
    for (ToolCall call : toolCalls) {
      wireCalls.add(
          Map.of(
              "id", call.id,
              "type", "function",
              "function", Map.of("name", call.name, "arguments", call.arguments)));
    }

    Message assistant = Messages.assistant("");
    Messages.metadata(assistant).put("tool_calls", wireCalls);
    messages.add(assistant);

    for (int i = 0; i < toolCalls.size(); i++) {
      ToolCall call = toolCalls.get(i);
      // A missing result still needs its message: OpenAI rejects a conversation where a requested
      // tool call has no answer, so an empty answer beats an absent one.
      String result = i < results.size() ? results.get(i) : "";
      Message message = Messages.toolResult(call.id, result);
      Messages.metadata(message).put("name", call.name);
      messages.add(message);
    }
    return messages;
  }
}
