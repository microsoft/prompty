package com.microsoft.prompty.openai;

import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.Processor;
import com.microsoft.prompty.StreamFailure;
import com.microsoft.prompty.Streams;
import com.microsoft.prompty.model.DelegatedStateReference;
import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.InvocationUsage;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import com.microsoft.prompty.model.TypraJson;
import com.microsoft.prompty.model.UsageChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

/** Extracts usable results from OpenAI chat, responses, embedding, and image payloads. */
public class OpenAIProcessor implements Processor {

  /**
   * Metadata key recording which message prefix a Responses continuation stands for.
   *
   * <p>A {@code previous_response_id} is only reusable against the exact conversation it was issued
   * for. Recording that prefix from the immutable request snapshot is what lets a later turn tell
   * whether the continuation still applies, instead of guessing from message history that may since
   * have been edited or compacted.
   */
  public static final String RESPONSES_CONTINUATION_BOUNDARY = "prompty.openai.responses.boundary";

  /** The provider key this processor is registered under. */
  protected String providerName() {
    return "openai";
  }

  /**
   * Whether this provider's Responses API can restore server-side context.
   *
   * <p>Chat completions cannot: their response IDs identify a completion, not resumable state.
   */
  protected boolean supportsResponsesContinuation() {
    return true;
  }

  @Override
  public Object process(Agent agent, Object response) {
    return processResponse(agent, response);
  }

  @Override
  public ModelInvocationResponse processWithContext(
      Agent agent, Object response, ModelInvocationRequest request) {
    return mapInvocationResponse(agent, response, request);
  }

  @Override
  public ModelInvocationResponse processRawWithContext(
      Agent agent, Object response, ModelInvocationRequest request) {
    ModelInvocationResponse mapped = mapInvocationResponse(agent, response, request);
    // Raw execution promised the provider's own words, so the interpreted output and the tool
    // requests derived from it are replaced by the payload as received.
    mapped.output = response;
    mapped.toolRequests = new ArrayList<>();
    return mapped;
  }

  @Override
  public Iterator<StreamChunk> processStream(Agent agent, Iterator<Object> response) {
    return new StreamProcessor(response);
  }

  // -------------------------------------------------------- invocation contract

  private ModelInvocationResponse mapInvocationResponse(
      Agent agent, Object response, ModelInvocationRequest request) {
    Object output = processResponse(agent, response);

    List<ModelToolRequest> toolRequests = new ArrayList<>();
    for (ToolCall call : extractToolCalls(output)) {
      ModelToolRequest toolRequest = new ModelToolRequest();
      toolRequest.id = call.id;
      toolRequest.name = call.name;
      // Arguments arrive as a JSON string. Decoding them here means downstream tool dispatch works
      // with data; the raw string is kept when it is not valid JSON so nothing is silently lost.
      Object parsed = tryParseJson(call.arguments);
      toolRequest.arguments = parsed == null ? call.arguments : parsed;
      toolRequests.add(toolRequest);
    }

    InvocationContextState contextState = contextState(response, request);
    ModelInvocationResponse mapped = new ModelInvocationResponse();
    mapped.output = toolRequests.isEmpty() ? output : null;
    mapped.usage = invocationUsage(response);
    mapped.assistantMessages =
        contextState.portability == InvocationContextPortability.PORTABLE
            ? portableAssistantMessages(response)
            : new ArrayList<>();
    mapped.toolRequests = toolRequests;
    mapped.nextContextState = contextState;
    return mapped;
  }

  private InvocationContextState contextState(Object response, ModelInvocationRequest request) {
    InvocationContextState state = new InvocationContextState();
    state.delegatedState = new ArrayList<>();

    String responseId = supportsResponsesContinuation() ? responsesId(response) : null;
    if (responseId == null) {
      state.portability = InvocationContextPortability.PORTABLE;
      return state;
    }

    DelegatedStateReference reference = new DelegatedStateReference();
    reference.provider = providerName();
    reference.kind = "response";
    reference.id = responseId;

    List<Message> messages =
        request == null || request.context == null ? List.of() : request.context.messages;
    Map<String, Object> boundary = new LinkedHashMap<>();
    boundary.put("inputMessages", messages == null ? List.of() : messages);
    reference.metadata = Map.of(RESPONSES_CONTINUATION_BOUNDARY, boundary);

    state.portability = InvocationContextPortability.DELEGATED;
    state.delegatedState.add(reference);
    return state;
  }

  private static String responsesId(Object response) {
    if (!isResponsesPayload(response)) {
      return null;
    }
    Object id = Streams.pointer(response, "id");
    return id instanceof String text && !text.isEmpty() ? text : null;
  }

  private List<Message> portableAssistantMessages(Object response) {
    List<Message> messages = new ArrayList<>();

    if (isResponsesPayload(response)) {
      for (Object item : asList(Streams.pointer(response, "output"))) {
        if ("function_call".equals(Streams.pointer(item, "type"))) {
          Message call = Messages.withText(Role.ASSISTANT, "");
          // The provider's own function-call item is preserved verbatim: replaying a synthesised
          // equivalent would lose the identifiers it matches its own state against.
          Messages.metadata(call).put("responses_function_call", item);
          messages.add(call);
        }
      }
      if (!messages.isEmpty()) {
        return messages;
      }
      messages.add(Messages.assistant(stringOrEmpty(Streams.pointer(response, "output_text"))));
      return messages;
    }

    Object message = Streams.pointer(response, "choices", 0, "message");
    if (message == null) {
      return messages;
    }
    Message assistant = Messages.assistant(stringOrEmpty(Streams.pointer(message, "content")));
    Object toolCalls = Streams.pointer(message, "tool_calls");
    if (toolCalls instanceof List<?> calls) {
      Messages.metadata(assistant).put("tool_calls", new ArrayList<Object>(calls));
    }
    messages.add(assistant);
    return messages;
  }

  private static InvocationUsage invocationUsage(Object response) {
    return usageFrom(Streams.pointer(response, "usage"));
  }

  private static InvocationUsage usageFrom(Object value) {
    Long input = asLong(firstNonNull(Streams.pointer(value, "input_tokens"), Streams.pointer(value, "prompt_tokens")));
    Long output =
        asLong(firstNonNull(Streams.pointer(value, "output_tokens"), Streams.pointer(value, "completion_tokens")));
    if (input == null || output == null) {
      return null;
    }
    Long total = asLong(Streams.pointer(value, "total_tokens"));
    InvocationUsage usage = new InvocationUsage();
    usage.inputTokens = input;
    usage.outputTokens = output;
    usage.totalTokens = total == null ? input + output : total;
    return usage;
  }

  // ------------------------------------------------------------- dispatch

  /** Interpret a raw OpenAI payload, dispatching on its shape. */
  public static Object processResponse(Agent agent, Object response) {
    if (isResponsesPayload(response)) {
      return processResponsesApi(agent, response);
    }

    Object choices = Streams.pointer(response, "choices");
    if (choices instanceof List<?> list) {
      return processChatCompletion(agent, list);
    }

    Object data = Streams.pointer(response, "data");
    if ("list".equals(Streams.pointer(response, "object")) && data instanceof List<?> list) {
      return processEmbedding(list);
    }

    if (data instanceof List<?> list) {
      for (Object item : list) {
        if (Streams.pointer(item, "url") != null || Streams.pointer(item, "b64_json") != null) {
          return processImage(list);
        }
      }
    }

    // An unrecognised shape is handed back untouched rather than forced into a guess; the caller
    // can still see everything the provider sent.
    return response;
  }

  private static Object processChatCompletion(Agent agent, List<?> choices) {
    if (choices.isEmpty()) {
      throw InvokerException.process("Empty choices array");
    }
    Object message = Streams.pointer(choices.get(0), "message");
    if (message == null) {
      throw InvokerException.process("Missing message in choice");
    }

    // A tool call outranks any content the model also produced: it is a request for work, and
    // treating it as prose would strand the turn.
    Object toolCalls = Streams.pointer(message, "tool_calls");
    if (toolCalls instanceof List<?> calls && !calls.isEmpty()) {
      List<Object> normalized = new ArrayList<>();
      for (Object call : calls) {
        Object function = firstNonNull(Streams.pointer(call, "function"), call);
        normalized.add(
            Map.of(
                "id", stringOrEmpty(Streams.pointer(call, "id")),
                "name", stringOrEmpty(Streams.pointer(function, "name")),
                "arguments", stringOr(Streams.pointer(function, "arguments"), "{}")));
      }
      return normalized;
    }

    Object content = Streams.pointer(message, "content");
    if (content == null) {
      Object refusal = Streams.pointer(message, "refusal");
      if (refusal instanceof String text) {
        return text;
      }
    }
    return structuredOrText(agent, stringOrEmpty(content));
  }

  private static Object processResponsesApi(Agent agent, Object response) {
    List<Object> toolCalls = new ArrayList<>();
    for (Object item : asList(Streams.pointer(response, "output"))) {
      if ("function_call".equals(Streams.pointer(item, "type"))) {
        toolCalls.add(
            Map.of(
                "id", stringOrEmpty(Streams.pointer(item, "call_id")),
                "name", stringOrEmpty(Streams.pointer(item, "name")),
                "arguments", stringOr(Streams.pointer(item, "arguments"), "{}")));
      }
    }
    if (!toolCalls.isEmpty()) {
      return toolCalls;
    }
    return structuredOrText(agent, stringOrEmpty(Streams.pointer(response, "output_text")));
  }

  /**
   * Decode declared structured output, falling back to the raw text.
   *
   * <p>Falling back rather than failing keeps a malformed reply visible to the caller, who is better
   * placed to decide whether to retry than a processor throwing on the model's behalf.
   */
  private static Object structuredOrText(Agent agent, String text) {
    if (agent != null && agent.outputs != null && !agent.outputs.isEmpty()) {
      Object parsed = tryParseJson(text);
      if (parsed != null) {
        return parsed;
      }
    }
    return text;
  }

  private static Object processEmbedding(List<?> data) {
    List<Object> vectors = new ArrayList<>();
    for (Object item : data) {
      Object embedding = Streams.pointer(item, "embedding");
      if (embedding != null) {
        vectors.add(embedding);
      }
    }
    return vectors.size() == 1 ? vectors.get(0) : vectors;
  }

  private static Object processImage(List<?> data) {
    List<Object> images = new ArrayList<>();
    for (Object item : data) {
      // A URL is preferred when both are present; base64 is the fallback for providers or settings
      // that never issue one.
      images.add(firstNonNull(Streams.pointer(item, "url"), Streams.pointer(item, "b64_json")));
    }
    return images.size() == 1 ? images.get(0) : images;
  }

  /** Recognise tool calls in an already-processed output. */
  public static List<ToolCall> extractToolCalls(Object output) {
    List<ToolCall> calls = new ArrayList<>();
    if (!(output instanceof List<?> list)) {
      return calls;
    }
    for (Object item : list) {
      if (!(Streams.pointer(item, "id") instanceof String id)
          || !(Streams.pointer(item, "name") instanceof String name)
          || !(Streams.pointer(item, "arguments") instanceof String arguments)) {
        return new ArrayList<>();
      }
      ToolCall call = new ToolCall();
      call.id = id;
      call.name = name;
      call.arguments = arguments;
      calls.add(call);
    }
    return calls;
  }

  // ------------------------------------------------------------ streaming

  /**
   * Turns OpenAI's server-sent events into typed chunks.
   *
   * <p>Text is forwarded as it arrives; tool calls are accumulated across deltas and emitted once
   * complete, because a half-assembled call is not something a caller can act on. Usage comes last,
   * so a consumer that stops at the first tool call has still seen every chunk that matters.
   */
  private static final class StreamProcessor implements Iterator<StreamChunk>, java.io.Closeable {

    private final Iterator<Object> source;
    /** Partial tool calls keyed by their wire index, which is how deltas identify themselves. */
    private final Map<Integer, ToolCall> partialCalls = new java.util.TreeMap<>();
    private final Map<String, Integer> itemSlots = new LinkedHashMap<>();

    private final List<StreamChunk> pending = new ArrayList<>();
    private InvocationUsage usage;
    private boolean drained;
    private boolean finished;

    StreamProcessor(Iterator<Object> source) {
      this.source = source;
    }

    @Override
    public boolean hasNext() {
      advance();
      return !pending.isEmpty();
    }

    @Override
    public StreamChunk next() {
      advance();
      if (pending.isEmpty()) {
        throw new NoSuchElementException();
      }
      return pending.remove(0);
    }

    private void advance() {
      while (pending.isEmpty() && !finished) {
        if (source.hasNext()) {
          consume(source.next());
        } else if (!drained) {
          drain();
        } else {
          finished = true;
        }
      }
    }

    private void consume(Object chunk) {
      Object error = Streams.pointer(chunk, "error");
      if (error != null) {
        String message = stringOr(Streams.pointer(error, "message"), "OpenAI stream failed");
        // A transport failure leaves the request's fate unknown — the provider may have completed
        // it after the connection dropped — so it is reported separately from a decided error.
        pending.add(
            "sse_transport_error".equals(Streams.pointer(error, "type"))
                ? StreamFailure.indeterminate(message)
                : StreamFailure.determinate(message));
        finish();
        return;
      }

      if (consumeResponsesEvent(chunk)) {
        return;
      }

      Object usageValue = Streams.pointer(chunk, "usage");
      if (usageValue != null) {
        InvocationUsage parsed = usageFrom(usageValue);
        if (parsed != null) {
          usage = parsed;
        }
      }

      Object delta = Streams.pointer(chunk, "choices", 0, "delta");
      if (delta == null) {
        return;
      }

      if (Streams.pointer(delta, "content") instanceof String content && !content.isEmpty()) {
        pending.add(textChunk(content));
      }

      for (Object toolDelta : asList(Streams.pointer(delta, "tool_calls"))) {
        Long index = asLong(Streams.pointer(toolDelta, "index"));
        ToolCall call = partialCalls.computeIfAbsent(index == null ? 0 : index.intValue(), key -> new ToolCall());
        if (Streams.pointer(toolDelta, "id") instanceof String id) {
          call.id = id;
        }
        if (Streams.pointer(toolDelta, "function", "name") instanceof String name) {
          call.name = name;
        }
        if (Streams.pointer(toolDelta, "function", "arguments") instanceof String arguments) {
          call.arguments = call.arguments + arguments;
        }
      }

      // Spec §10.3: a refusal ends the stream. Continuing would let a partial answer look complete.
      if (Streams.pointer(delta, "refusal") instanceof String refusal && !refusal.isEmpty()) {
        pending.add(errorChunk("Model refused: " + refusal));
        finish();
      }
    }

    /** Handle a Responses API event, reporting whether the chunk was one. */
    private boolean consumeResponsesEvent(Object chunk) {
      if (!(Streams.pointer(chunk, "type") instanceof String type)) {
        return false;
      }
      switch (type) {
        case "response.output_text.delta" -> {
          if (Streams.pointer(chunk, "delta") instanceof String text && !text.isEmpty()) {
            pending.add(textChunk(text));
          }
        }
        case "response.output_item.added", "response.output_item.done" -> {
          Object item = Streams.pointer(chunk, "item");
          if ("function_call".equals(Streams.pointer(item, "type"))) {
            Long index = asLong(Streams.pointer(chunk, "output_index"));
            int slot = index == null ? partialCalls.size() : index.intValue();
            partialCalls.put(slot, toolCallFrom(item));
            // Argument events identify their target by item id, which is distinct from the call id
            // the tool result must later be correlated with, so both have to be remembered.
            if (Streams.pointer(item, "id") instanceof String itemId && !itemId.isEmpty()) {
              itemSlots.put(itemId, slot);
            }
          }
        }
        case "response.function_call_arguments.delta" -> {
          applyArguments(chunk, Streams.pointer(chunk, "delta"), false);
        }
        case "response.function_call_arguments.done" -> {
          applyArguments(chunk, Streams.pointer(chunk, "arguments"), true);
        }
        case "response.completed" -> {
          InvocationUsage parsed = usageFrom(Streams.pointer(chunk, "response", "usage"));
          if (parsed != null) {
            usage = parsed;
          }
          // The terminal event carries the authoritative output, which supersedes anything
          // accumulated from deltas that may have been truncated.
          List<Object> output = asList(Streams.pointer(chunk, "response", "output"));
          for (int i = 0; i < output.size(); i++) {
            Object item = output.get(i);
            if ("function_call".equals(Streams.pointer(item, "type"))) {
              partialCalls.put(i, toolCallFrom(item));
            }
          }
        }
        case "response.refusal.delta" -> {
          if (Streams.pointer(chunk, "delta") instanceof String refusal && !refusal.isEmpty()) {
            pending.add(errorChunk("Model refused: " + refusal));
            finish();
          }
        }
        default -> {
          return false;
        }
      }
      return true;
    }

    /**
     * Route an argument fragment to the call it belongs to.
     *
     * <p>The event identifies its target inconsistently: {@code call_id} where the provider echoes
     * it, otherwise {@code item_id}, otherwise only the output index. Trying all three keeps
     * arguments from being silently dropped, which would leave the model's tool call unusable.
     */
    private void applyArguments(Object chunk, Object arguments, boolean replace) {
      if (!(arguments instanceof String text)) {
        return;
      }

      ToolCall target = null;
      if (Streams.pointer(chunk, "call_id") instanceof String callId && !callId.isEmpty()) {
        for (ToolCall call : partialCalls.values()) {
          if (callId.equals(call.id)) {
            target = call;
            break;
          }
        }
      }
      if (target == null && Streams.pointer(chunk, "item_id") instanceof String itemId) {
        Integer slot = itemSlots.get(itemId);
        target = slot == null ? null : partialCalls.get(slot);
      }
      if (target == null) {
        Long index = asLong(Streams.pointer(chunk, "output_index"));
        target = index == null ? null : partialCalls.get(index.intValue());
      }
      if (target == null) {
        return;
      }

      target.arguments = replace ? text : target.arguments + text;
    }

    private void drain() {
      drained = true;
      for (ToolCall call : partialCalls.values()) {
        ToolChunk chunk = new ToolChunk();
        chunk.toolCall = call;
        pending.add(chunk);
      }
      if (usage != null) {
        UsageChunk chunk = new UsageChunk();
        chunk.usage = usage;
        pending.add(chunk);
      }
    }

    /**
     * Stop after a terminal chunk, discarding anything the provider may still be sending.
     *
     * <p>The provider is mid-send, so the connection is released rather than read to completion:
     * whatever follows a refusal or a fatal error is not something a caller may act on.
     */
    private void finish() {
      drained = true;
      finished = true;
      close();
    }

    @Override
    public void close() {
      Streams.close(source);
    }
  }

  private static ToolCall toolCallFrom(Object item) {
    ToolCall call = new ToolCall();
    call.id = stringOrEmpty(Streams.pointer(item, "call_id"));
    call.name = stringOrEmpty(Streams.pointer(item, "name"));
    call.arguments = stringOrEmpty(Streams.pointer(item, "arguments"));
    return call;
  }

  private static TextChunk textChunk(String value) {
    TextChunk chunk = new TextChunk();
    chunk.value = value;
    return chunk;
  }

  private static ErrorChunk errorChunk(String message) {
    return StreamFailure.determinate(message);
  }

  // ------------------------------------------------------------- helpers

  static boolean isResponsesPayload(Object response) {
    return "response".equals(Streams.pointer(response, "object"));
  }

  private static Object tryParseJson(String text) {
    if (text == null || text.isEmpty()) {
      return null;
    }
    try {
      return TypraJson.parse(text);
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static List<Object> asList(Object value) {
    return value instanceof List<?> list ? new ArrayList<Object>(list) : List.of();
  }

  private static Object firstNonNull(Object first, Object second) {
    return first != null ? first : second;
  }

  private static Long asLong(Object value) {
    return value instanceof Number number ? number.longValue() : null;
  }

  private static String stringOrEmpty(Object value) {
    return stringOr(value, "");
  }

  private static String stringOr(Object value, String fallback) {
    return value instanceof String text ? text : fallback;
  }
}
