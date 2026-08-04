package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.ToolCall;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sends messages to a model provider and returns its raw response.
 *
 * <p>Registered under the {@code prompty.executors} group, keyed by {@code agent.model.provider}.
 *
 * <p>Only {@link #execute} is required. Streaming and context-aware invocation have defaults so a
 * minimal executor stays small, and so adding a capability to this interface does not break existing
 * implementations.
 */
public interface Executor {

  /**
   * Invoke the provider and return its raw, unprocessed response.
   *
   * <p>The return value is a plain JSON-shaped tree — {@code Map}, {@code List}, {@code String},
   * {@code Number}, {@code Boolean}, or null — matching the representation the generated model layer
   * loads from. Interpreting it is the {@link Processor}'s job.
   *
   * @throws InvokerException with {@link InvokerException.Kind#EXECUTE} if the call fails
   */
  Object execute(Prompty agent, List<Message> messages);

  /**
   * Invoke the provider from a generated invocation request.
   *
   * <p>The default forwards the request's message snapshot to {@link #execute}, so an executor that
   * knows nothing about delegated provider state still works. Providers that can resume server-side
   * conversation state should override this and consume the request directly.
   */
  default Object executeWithContext(
      Prompty agent, ModelInvocationRequest request, CancellationToken cancellation) {
    cancellation.throwIfCancelled("execution cancelled before provider invocation");
    Object result = execute(agent, messagesOf(request));
    cancellation.throwIfCancelled("execution cancelled during provider invocation");
    return result;
  }

  /**
   * Invoke the provider and return an iterator over raw response chunks.
   *
   * <p>Each element is one raw chunk as the provider sent it, before any processing.
   *
   * @throws InvokerException with {@link InvokerException.Kind#EXECUTE} if streaming is unsupported
   */
  default Iterator<Object> executeStream(Prompty agent, List<Message> messages) {
    throw InvokerException.execute("Streaming not supported by this executor");
  }

  /**
   * Stream from the provider, abandoning the response as soon as cancellation is requested.
   *
   * <p>The default opens the stream through {@link #executeStream} and wraps it so every subsequent
   * advance observes the token. A provider that can abort the underlying HTTP request should
   * override this to release the connection rather than merely stop reading.
   */
  default Iterator<Object> executeStreamCancellable(
      Prompty agent, List<Message> messages, CancellationToken cancellation) {
    cancellation.throwIfCancelled("streaming execution cancelled before provider invocation");
    Iterator<Object> stream = executeStream(agent, messages);
    return Streams.cancellable(stream, cancellation);
  }

  /** Stream from the provider using a generated invocation request. */
  default Iterator<Object> executeStreamWithContext(
      Prompty agent, ModelInvocationRequest request, CancellationToken cancellation) {
    return executeStreamCancellable(agent, messagesOf(request), cancellation);
  }

  /**
   * Build the messages that carry a round of tool results back to the provider.
   *
   * <p>The default is the OpenAI-style pattern: one assistant message echoing the tool calls,
   * followed by one tool message per result. Providers that expect a different shape — Anthropic
   * nests tool results inside a user message, for instance — override this.
   *
   * @param rawResponse the raw response the tool calls came from, for providers that must echo it
   * @param toolCalls the calls the model requested
   * @param toolResults the results, positionally aligned with {@code toolCalls}
   * @param textContent any assistant text that accompanied the tool calls
   */
  default List<Message> formatToolMessages(
      Object rawResponse, List<ToolCall> toolCalls, List<String> toolResults, String textContent) {
    List<Message> messages = new ArrayList<>();

    List<Object> wireCalls = new ArrayList<>(toolCalls.size());
    for (ToolCall call : toolCalls) {
      Map<String, Object> function = new LinkedHashMap<>();
      function.put("name", call.name);
      function.put("arguments", call.arguments);

      Map<String, Object> wire = new LinkedHashMap<>();
      wire.put("id", call.id);
      wire.put("type", "function");
      wire.put("function", function);
      wireCalls.add(wire);
    }

    Message assistant = new Message();
    assistant.role = Role.ASSISTANT;
    assistant.parts = new ArrayList<>();
    assistant.metadata = new LinkedHashMap<>();
    assistant.metadata.put("tool_calls", wireCalls);
    messages.add(assistant);

    int count = Math.min(toolCalls.size(), toolResults.size());
    for (int i = 0; i < count; i++) {
      messages.add(Messages.toolResult(toolCalls.get(i).id, toolResults.get(i)));
    }

    return messages;
  }

  /**
   * Build tool-result messages for a streamed response.
   *
   * <p>Defaults to {@link #formatToolMessages} with no raw response, which is correct for
   * OpenAI-compatible providers. Providers that must replay raw streamed assistant content override
   * this and consume {@code rawChunks}.
   */
  default List<Message> formatStreamToolMessages(
      List<Object> rawChunks,
      List<ToolCall> toolCalls,
      List<String> toolResults,
      String textContent) {
    return formatToolMessages(null, toolCalls, toolResults, textContent);
  }

  private static List<Message> messagesOf(ModelInvocationRequest request) {
    if (request == null || request.context == null || request.context.messages == null) {
      return List.of();
    }
    return request.context.messages;
  }
}
