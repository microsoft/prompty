package com.microsoft.prompty.openai;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Connections;
import com.microsoft.prompty.Environment;
import com.microsoft.prompty.Executor;
import com.microsoft.prompty.Http;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Streams;
import com.microsoft.prompty.model.AnonymousConnection;
import com.microsoft.prompty.model.ApiKeyConnection;
import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.FoundryConnection;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.OAuthConnection;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.RemoteConnection;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.ToolCall;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Sends requests to the OpenAI chat, responses, embedding, and image endpoints. */
public class OpenAIExecutor implements Executor {

  private static final String DEFAULT_ENDPOINT = "https://api.openai.com";

  /** The provider name used in error messages and delegated-state lookups. */
  protected String providerName() {
    return "openai";
  }

  @Override
  public Object execute(Prompty agent, List<Message> messages) {
    return executeRequest(agent, messages, null);
  }

  @Override
  public Object executeWithContext(
      Prompty agent, ModelInvocationRequest request, CancellationToken cancellation) {
    cancellation.throwIfCancelled(
        "execution cancelled before " + providerName() + " provider invocation");
    Object result = executeRequest(agent, messagesOf(request), request);
    // Checked again after the call because a cancellation that arrives mid-flight still means the
    // caller no longer wants the result, even though the provider has already acted on it.
    cancellation.throwIfCancelled(
        "execution cancelled during " + providerName() + " provider invocation");
    return result;
  }

  @Override
  public Iterator<Object> executeStream(Prompty agent, List<Message> messages) {
    return executeStreamRequest(agent, messages, null);
  }

  @Override
  public Iterator<Object> executeStreamWithContext(
      Prompty agent, ModelInvocationRequest request, CancellationToken cancellation) {
    cancellation.throwIfCancelled(
        "streaming execution cancelled before " + providerName() + " provider invocation");
    return Streams.cancellable(executeStreamRequest(agent, messagesOf(request), request), cancellation);
  }

  @Override
  public List<Message> formatToolMessages(
      Object rawResponse, List<ToolCall> toolCalls, List<String> toolResults, String textContent) {
    if (OpenAIProcessor.isResponsesPayload(rawResponse)) {
      return formatResponsesToolMessages(
          Streams.pointer(rawResponse, "output"), toolCalls, toolResults);
    }
    return Wire.formatToolMessages(toolCalls, toolResults);
  }

  @Override
  public List<Message> formatStreamToolMessages(
      List<Object> rawChunks, List<ToolCall> toolCalls, List<String> toolResults, String textContent) {
    // A Responses stream is recognised by its event names; a chat stream carries none of them and
    // replays through the ordinary chat shape.
    for (Object chunk : rawChunks) {
      if (Streams.pointer(chunk, "type") instanceof String type && type.startsWith("response.")) {
        return formatResponsesToolMessages(streamedFunctionCalls(rawChunks), toolCalls, toolResults);
      }
    }
    return Wire.formatToolMessages(toolCalls, toolResults);
  }

  /**
   * Rebuild the function-call items a Responses stream delivered piecewise.
   *
   * <p>The terminal {@code response.completed} event carries the authoritative list; the per-item
   * events are used only when the stream ended before it arrived.
   */
  private static Object streamedFunctionCalls(List<Object> rawChunks) {
    Map<String, Object> byCallId = new LinkedHashMap<>();
    for (Object chunk : rawChunks) {
      Object type = Streams.pointer(chunk, "type");
      if ("response.completed".equals(type)) {
        Object output = Streams.pointer(chunk, "response", "output");
        if (output instanceof List<?> items) {
          for (Object item : items) {
            if ("function_call".equals(Streams.pointer(item, "type"))) {
              byCallId.put(String.valueOf(Streams.pointer(item, "call_id")), item);
            }
          }
        }
      } else if ("response.output_item.done".equals(type) || "response.output_item.added".equals(type)) {
        Object item = Streams.pointer(chunk, "item");
        if ("function_call".equals(Streams.pointer(item, "type"))) {
          byCallId.putIfAbsent(String.valueOf(Streams.pointer(item, "call_id")), item);
        }
      }
    }
    return new ArrayList<Object>(byCallId.values());
  }

  /**
   * Replay a Responses tool round as conversation messages.
   *
   * <p>The provider's own function-call items are carried through untouched so a continuation can
   * still match them, with one output message per result following.
   */
  private static List<Message> formatResponsesToolMessages(
      Object output, List<ToolCall> toolCalls, List<String> toolResults) {
    List<Message> messages = new ArrayList<>();
    Map<String, Object> callsById = new LinkedHashMap<>();
    if (output instanceof List<?> items) {
      for (Object item : items) {
        if ("function_call".equals(Streams.pointer(item, "type"))) {
          callsById.put(String.valueOf(Streams.pointer(item, "call_id")), item);
        }
      }
    }

    for (ToolCall call : toolCalls) {
      Object item = callsById.get(call.id);
      if (item != null) {
        Message assistant = com.microsoft.prompty.Messages.withText(
            com.microsoft.prompty.model.Role.ASSISTANT, "");
        com.microsoft.prompty.Messages.metadata(assistant).put("responses_function_call", item);
        messages.add(assistant);
      }
    }

    for (int i = 0; i < toolCalls.size(); i++) {
      messages.add(
          com.microsoft.prompty.Messages.toolResult(
              toolCalls.get(i).id, i < toolResults.size() ? toolResults.get(i) : ""));
    }
    return messages;
  }

  // --------------------------------------------------------------- request

  private Object executeRequest(
      Prompty agent, List<Message> messages, ModelInvocationRequest request) {
    String apiType = apiType(agent);
    Map<String, Object> body = buildRequestArgs(agent, messages, request);
    String url = endpointFor(agent, apiType, false);
    return Http.postJson(providerName(), url, authHeaders(agent), body);
  }

  private Iterator<Object> executeStreamRequest(
      Prompty agent, List<Message> messages, ModelInvocationRequest request) {
    String apiType = apiType(agent);
    Map<String, Object> body = buildRequestArgs(agent, messages, request);
    String url = endpointFor(agent, apiType, true);
    Wire.enableStreaming(body, apiType);
    return Http.postSse(providerName(), url, authHeaders(agent), body);
  }

  /** Build the request body without sending it. */
  public Map<String, Object> buildArgs(Prompty agent, List<Message> messages) {
    return buildRequestArgs(agent, messages, null);
  }

  private Map<String, Object> buildRequestArgs(
      Prompty agent, List<Message> messages, ModelInvocationRequest request) {
    String apiType = apiType(agent);
    return switch (apiType) {
      case "chat", "agent" -> Wire.buildChatArgs(agent, messages);
      case "responses" -> buildResponsesRequestArgs(agent, messages, request);
      case "embedding" -> Wire.buildEmbeddingArgs(agent, messages);
      case "image" -> Wire.buildImageArgs(agent, messages);
      default -> throw InvokerException.execute("Unsupported apiType: " + apiType);
    };
  }

  /**
   * Build a Responses request, continuing from provider-held state when that is still valid.
   *
   * <p>Continuing lets the provider keep the conversation prefix, so only the new turns are sent.
   */
  private Map<String, Object> buildResponsesRequestArgs(
      Prompty agent, List<Message> messages, ModelInvocationRequest request) {
    Continuation continuation = responsesContinuation(request);
    List<Message> input = messages;

    if (continuation != null) {
      input = new ArrayList<>(messages.subList(continuation.messageCount(), messages.size()));
      // The provider already holds its own function-call items; resending them would duplicate
      // what the continuation is standing in for.
      input.removeIf(Wire::isResponsesFunctionCall);
    }

    Map<String, Object> args = Wire.buildResponsesArgs(agent, input);
    if (continuation != null) {
      args.put("previous_response_id", continuation.responseId());
    }
    return args;
  }

  private record Continuation(String responseId, int messageCount) {}

  /**
   * The provider-held state this request may continue from, if any.
   *
   * <p>A response ID only stands for the exact message prefix that produced it. When the current
   * conversation no longer starts with that prefix — a policy trimmed it, a hook rewrote it,
   * compaction replaced it — continuing would silently mix two different contexts, so the request
   * falls back to replaying the whole conversation.
   */
  private Continuation responsesContinuation(ModelInvocationRequest request) {
    if (request == null || request.context == null || request.context.contextState == null) {
      return null;
    }
    var state = request.context.contextState;
    if (state.portability != InvocationContextPortability.DELEGATED || state.delegatedState == null) {
      return null;
    }

    for (var delegated : state.delegatedState) {
      if (!providerName().equals(delegated.provider)
          || !"response".equals(delegated.kind)
          || delegated.id == null
          || delegated.id.isEmpty()
          || delegated.metadata == null) {
        continue;
      }
      Object boundary =
          Streams.pointer(
              delegated.metadata, OpenAIProcessor.RESPONSES_CONTINUATION_BOUNDARY, "inputMessages");
      if (!(boundary instanceof List<?> recorded)) {
        continue;
      }

      List<Message> current = request.context.messages;
      if (current == null || current.size() < recorded.size()) {
        continue;
      }
      if (!prefixMatches(current, recorded)) {
        continue;
      }
      return new Continuation(delegated.id, recorded.size());
    }
    return null;
  }

  /**
   * Whether the conversation still begins with the recorded prefix.
   *
   * <p>Messages are compared through their saved form so that an equivalent message reconstructed
   * from storage still matches, while an edited one does not.
   */
  private static boolean prefixMatches(List<Message> current, List<?> recorded) {
    SaveContext context = new SaveContext();
    for (int i = 0; i < recorded.size(); i++) {
      Object expected = recorded.get(i);
      Object expectedSaved = expected instanceof Message message ? message.save(context) : expected;
      if (!current.get(i).save(context).equals(expectedSaved)) {
        return false;
      }
    }
    return true;
  }

  private static String apiType(Prompty agent) {
    String apiType = agent == null || agent.model == null ? null : agent.model.apiType;
    return apiType == null || apiType.isEmpty() ? "chat" : apiType;
  }

  // -------------------------------------------------------------- endpoint

  private String endpointFor(Prompty agent, String apiType, boolean streaming) {
    String path =
        switch (apiType) {
          case "chat", "agent" -> "/v1/chat/completions";
          case "responses" -> "/v1/responses";
          case "embedding" -> streaming ? null : "/v1/embeddings";
          case "image" -> streaming ? null : "/v1/images/generations";
          default -> null;
        };
    if (path == null) {
      throw InvokerException.execute(
          (streaming ? "Streaming not supported for apiType: " : "Unsupported apiType: ") + apiType);
    }
    return buildUrl(agent, path);
  }

  /** Resolve the base URL: the prompt's connection, then the environment, then the public API. */
  protected String buildUrl(Prompty agent, String path) {
    String endpoint = endpointOf(connection(agent));
    if (endpoint == null || endpoint.isEmpty()) {
      endpoint = Environment.lookup("OPENAI_BASE_URL").filter(v -> !v.isEmpty()).orElse(DEFAULT_ENDPOINT);
    }

    String base = endpoint.endsWith("/") ? endpoint.substring(0, endpoint.length() - 1) : endpoint;
    // A proxy base is commonly written with the version already on it; appending another would
    // produce /v1/v1/chat/completions.
    if (base.endsWith("/v1") && path.startsWith("/v1")) {
      return base + path.substring("/v1".length());
    }
    return base + path;
  }

  /** The headers that authenticate the request. */
  protected Map<String, String> authHeaders(Prompty agent) {
    return Map.of("Authorization", "Bearer " + apiKey(agent));
  }

  /** Resolve the API key from the prompt's connection, falling back to the environment. */
  protected String apiKey(Prompty agent) {
    Connection connection = connection(agent);
    if (connection instanceof ApiKeyConnection apiKey
        && apiKey.apiKey != null
        && !apiKey.apiKey.isEmpty()) {
      return apiKey.apiKey;
    }
    return Environment.lookup("OPENAI_API_KEY")
        .filter(key -> !key.isEmpty())
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "No API key found. Set OPENAI_API_KEY or configure model.connection.apiKey"));
  }

  /** The prompt's connection with any reference followed to the concrete one. */
  protected static Connection connection(Prompty agent) {
    Connection connection = agent == null || agent.model == null ? null : agent.model.connection;
    return connection == null ? null : Connections.resolve(connection);
  }

  /**
   * The endpoint a connection carries.
   *
   * <p>{@code endpoint} is declared per connection kind rather than on the base type, so each kind
   * that has one is asked directly.
   */
  protected static String endpointOf(Connection connection) {
    if (connection instanceof ApiKeyConnection apiKey) {
      return apiKey.endpoint;
    }
    if (connection instanceof AnonymousConnection anonymous) {
      return anonymous.endpoint;
    }
    if (connection instanceof RemoteConnection remote) {
      return remote.endpoint;
    }
    if (connection instanceof OAuthConnection oauth) {
      return oauth.endpoint;
    }
    if (connection instanceof FoundryConnection foundry) {
      return foundry.endpoint;
    }
    return null;
  }

  private static List<Message> messagesOf(ModelInvocationRequest request) {
    if (request == null || request.context == null || request.context.messages == null) {
      return List.of();
    }
    return request.context.messages;
  }
}
