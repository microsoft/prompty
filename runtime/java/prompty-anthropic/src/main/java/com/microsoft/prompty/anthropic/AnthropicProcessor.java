package com.microsoft.prompty.anthropic;

import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.Processor;
import com.microsoft.prompty.Streams;
import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.InvocationUsage;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ThinkingChunk;
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
import java.util.TreeMap;

/**
 * Interprets Anthropic Messages API responses.
 *
 * <p>An Anthropic response is a list of typed content blocks rather than a single message, so
 * "what did the model say" is a question about which blocks are present. Tool use wins over text:
 * when the model asks to call something, the text alongside it is commentary, and returning it as
 * the result would let a caller act on an answer the model had not finished forming.
 */
public final class AnthropicProcessor implements Processor {

  @Override
  public Object process(Prompty agent, Object response) {
    return processResponse(agent, response);
  }

  @Override
  public Iterator<StreamChunk> processStream(Prompty agent, Iterator<Object> response) {
    return new StreamProcessor(response);
  }

  @Override
  public ModelInvocationResponse processWithContext(
      Prompty agent, Object response, ModelInvocationRequest request) {
    Object output = processResponse(agent, response);
    List<ToolCall> calls = extractToolCalls(response);

    List<ModelToolRequest> toolRequests = new ArrayList<>();
    for (ToolCall call : calls) {
      ModelToolRequest tool = new ModelToolRequest();
      tool.id = call.id;
      tool.name = call.name;
      tool.arguments = decodeArguments(call.arguments);
      toolRequests.add(tool);
    }

    ModelInvocationResponse result = new ModelInvocationResponse();
    result.output = toolRequests.isEmpty() ? output : null;
    result.assistantMessages = assistantMessages(response);
    result.toolRequests = toolRequests;
    // The Messages API is stateless: nothing on the provider side survives the response, so the
    // whole context travels with the next request and there is no handle worth pretending to hold.
    result.nextContextState = portableState();
    return result;
  }

  @Override
  public ModelInvocationResponse processRawWithContext(
      Prompty agent, Object response, ModelInvocationRequest request) {
    ModelInvocationResponse result = new ModelInvocationResponse();
    result.output = response;
    result.assistantMessages = assistantMessages(response);
    result.toolRequests = new ArrayList<>();
    result.nextContextState = portableState();
    return result;
  }

  private static InvocationContextState portableState() {
    InvocationContextState state = new InvocationContextState();
    state.portability = InvocationContextPortability.PORTABLE;
    state.delegatedState = new ArrayList<>();
    return state;
  }

  // -------------------------------------------------------- single response

  /** Extract the usable result from a raw Messages API response. */
  public static Object processResponse(Prompty agent, Object response) {
    List<?> content = contentBlocks(response);
    if (content == null) {
      throw InvokerException.process("Invalid Anthropic response: missing 'content' array");
    }

    List<ToolCall> toolCalls = toolCallsIn(content);
    if (!toolCalls.isEmpty()) {
      List<Object> encoded = new ArrayList<>();
      for (ToolCall call : toolCalls) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("id", call.id);
        entry.put("name", call.name);
        entry.put("arguments", call.arguments);
        encoded.add(entry);
      }
      return encoded;
    }

    String text = Wire.joinText(content);

    if (agent != null && agent.outputs != null && !agent.outputs.isEmpty()) {
      // Structured output is a request, not a guarantee. A model that answers in prose has still
      // answered, so an undecodable reply is returned as written rather than raised as a failure.
      try {
        return TypraJson.parse(text);
      } catch (RuntimeException e) {
        return text;
      }
    }

    return text;
  }

  /** Collect the tool calls a response is asking for. */
  public static List<ToolCall> extractToolCalls(Object response) {
    List<?> content = contentBlocks(response);
    return content == null ? new ArrayList<>() : toolCallsIn(content);
  }

  private static List<?> contentBlocks(Object response) {
    Object content = Streams.pointer(response, "content");
    return content instanceof List<?> list ? list : null;
  }

  private static List<ToolCall> toolCallsIn(List<?> content) {
    List<ToolCall> calls = new ArrayList<>();
    for (Object block : content) {
      if (!"tool_use".equals(Streams.pointer(block, "type"))) {
        continue;
      }
      ToolCall call = new ToolCall();
      call.id = stringOrEmpty(Streams.pointer(block, "id"));
      call.name = stringOrEmpty(Streams.pointer(block, "name"));
      Object input = Streams.pointer(block, "input");
      call.arguments = input == null ? "" : TypraJson.stringify(input);
      calls.add(call);
    }
    return calls;
  }

  /**
   * The assistant turn this response represents.
   *
   * <p>The raw blocks ride along in metadata because Anthropic expects an assistant turn replayed
   * exactly — thinking blocks carry signatures that cannot be reconstructed from their text.
   */
  private static List<Message> assistantMessages(Object response) {
    List<?> content = contentBlocks(response);
    Message assistant = Messages.assistant(content == null ? "" : Wire.joinText(content));
    if (content != null && !content.isEmpty()) {
      // Deep-copied for the same reason as in Wire.formatToolMessages: this outlives the response.
      Messages.metadata(assistant).put("content", Streams.deepCopy(content));
    }
    List<Message> messages = new ArrayList<>();
    messages.add(assistant);
    return messages;
  }

  private static Object decodeArguments(String arguments) {
    if (arguments == null || arguments.isEmpty()) {
      return arguments;
    }
    try {
      return TypraJson.parse(arguments);
    } catch (RuntimeException e) {
      // The turn engine can still hand the raw string to a tool that knows what to do with it.
      return arguments;
    }
  }

  private static String stringOrEmpty(Object value) {
    return value instanceof String text ? text : "";
  }

  // -------------------------------------------------------- streaming

  /**
   * Turns Anthropic's SSE event stream into typed chunks.
   *
   * <p>Text and thinking are forwarded the moment they arrive, because that is the point of
   * streaming. Tool calls are not: their arguments arrive as JSON fragments across many events, and
   * a half-parsed argument object is not something a caller can act on — so they are accumulated and
   * emitted once the stream ends. Usage comes last of all, since Anthropic reports input tokens at
   * the start and output tokens at the end, and only their sum is meaningful.
   */
  private static final class StreamProcessor
      implements Iterator<StreamChunk>, java.io.Closeable {

    private final Iterator<Object> source;
    /** Accumulating tool calls keyed by content-block index, which is how deltas identify them. */
    private final Map<Integer, ToolCall> partialCalls = new TreeMap<>();

    private final List<StreamChunk> pending = new ArrayList<>();
    private long inputTokens;
    private long outputTokens;
    private boolean hasUsage;
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
        throw new NoSuchElementException("stream exhausted");
      }
      return pending.remove(0);
    }

    /** Pull events until something is ready to hand out, or the stream is genuinely over. */
    private void advance() {
      while (pending.isEmpty() && !finished) {
        if (drained) {
          emitTerminal();
          finished = true;
          return;
        }
        if (!source.hasNext()) {
          drained = true;
          continue;
        }
        consume(source.next());
      }
    }

    private void consume(Object event) {
      String type = stringOrEmpty(Streams.pointer(event, "type"));
      switch (type) {
        case "message_start" -> {
          Object usage = Streams.pointer(event, "message", "usage");
          if (usage != null) {
            inputTokens = longAt(usage, "input_tokens");
            hasUsage = true;
          }
        }
        case "message_delta" -> {
          Object usage = Streams.pointer(event, "usage");
          if (usage != null) {
            outputTokens = longAt(usage, "output_tokens");
            hasUsage = true;
          }
        }
        case "content_block_start" -> {
          Object block = Streams.pointer(event, "content_block");
          if ("tool_use".equals(Streams.pointer(block, "type"))) {
            ToolCall call = new ToolCall();
            call.id = stringOrEmpty(Streams.pointer(block, "id"));
            call.name = stringOrEmpty(Streams.pointer(block, "name"));
            call.arguments = "";
            partialCalls.put(indexOf(event), call);
          }
        }
        case "content_block_delta" -> consumeDelta(event);
        case "error" -> {
          // Deliberately unlike the Rust reference, which has no arm for a top-level `error` event
          // and lets its catch-all skip it. Anthropic emits these mid-stream for overload and
          // rate-limit conditions, so ignoring one hands the caller a silently truncated answer
          // with no indication that anything went wrong.
          String message = stringOrEmpty(Streams.pointer(event, "error", "message"));
          ErrorChunk error = new ErrorChunk();
          error.message = message.isEmpty() ? "Anthropic stream reported an error" : message;
          pending.add(error);
          // Nothing after an error is trustworthy, so the connection is released rather than read.
          drained = true;
          finished = true;
          close();
        }
        default -> {}
      }
    }

    private void consumeDelta(Object event) {
      Object delta = Streams.pointer(event, "delta");
      if (delta == null) {
        return;
      }
      switch (stringOrEmpty(Streams.pointer(delta, "type"))) {
        case "text_delta" -> {
          String text = stringOrEmpty(Streams.pointer(delta, "text"));
          if (!text.isEmpty()) {
            TextChunk chunk = new TextChunk();
            chunk.value = text;
            pending.add(chunk);
          }
        }
        case "thinking_delta" -> {
          String thinking = stringOrEmpty(Streams.pointer(delta, "thinking"));
          if (!thinking.isEmpty()) {
            ThinkingChunk chunk = new ThinkingChunk();
            chunk.value = thinking;
            pending.add(chunk);
          }
        }
        case "input_json_delta" -> {
          ToolCall call = partialCalls.get(indexOf(event));
          if (call != null) {
            call.arguments =
                (call.arguments == null ? "" : call.arguments)
                    + stringOrEmpty(Streams.pointer(delta, "partial_json"));
          }
        }
        default -> {}
      }
    }

    /** Emit whatever was withheld until the end: completed tool calls, then cumulative usage. */
    private void emitTerminal() {
      for (ToolCall call : partialCalls.values()) {
        ToolChunk chunk = new ToolChunk();
        chunk.toolCall = call;
        pending.add(chunk);
      }
      partialCalls.clear();

      if (hasUsage) {
        InvocationUsage usage = new InvocationUsage();
        usage.inputTokens = inputTokens;
        usage.outputTokens = outputTokens;
        usage.totalTokens = inputTokens + outputTokens;
        UsageChunk chunk = new UsageChunk();
        chunk.usage = usage;
        pending.add(chunk);
        hasUsage = false;
      }
    }

    private static int indexOf(Object event) {
      Object index = Streams.pointer(event, "index");
      return index instanceof Number number ? number.intValue() : 0;
    }

    private static long longAt(Object node, String key) {
      Object value = Streams.pointer(node, key);
      return value instanceof Number number ? number.longValue() : 0L;
    }

    @Override
    public void close() {
      Streams.close(source);
    }
  }
}
