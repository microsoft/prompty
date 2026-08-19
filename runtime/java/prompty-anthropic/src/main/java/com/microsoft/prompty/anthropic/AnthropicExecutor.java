package com.microsoft.prompty.anthropic;

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
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.OAuthConnection;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.RemoteConnection;
import com.microsoft.prompty.model.ToolCall;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Sends requests to the Anthropic Messages API.
 *
 * <p>Anthropic offers one endpoint, so unlike the OpenAI executor there is nothing to dispatch on
 * beyond rejecting API types the provider does not have. Authentication is an {@code x-api-key}
 * header rather than a bearer token, and every request carries an explicit API version — Anthropic
 * pins wire-format changes to that header, so sending it is what keeps this code correct as the API
 * moves on.
 */
public class AnthropicExecutor implements Executor {

  private static final String DEFAULT_ENDPOINT = "https://api.anthropic.com";

  /** The provider name used in error messages. */
  protected String providerName() {
    return "anthropic";
  }

  @Override
  public Object execute(Agent agent, List<Message> messages) {
    Map<String, Object> body = buildArgs(agent, messages);
    return Http.postJson(providerName(), buildUrl(agent), authHeaders(agent), body);
  }

  @Override
  public Object executeWithContext(
      Agent agent, ModelInvocationRequest request, CancellationToken cancellation) {
    cancellation.throwIfCancelled(
        "execution cancelled before " + providerName() + " provider invocation");
    Object result = execute(agent, messagesOf(request));
    // Checked again after the call because a cancellation that arrives mid-flight still means the
    // caller no longer wants the result, even though the provider has already acted on it.
    cancellation.throwIfCancelled(
        "execution cancelled during " + providerName() + " provider invocation");
    return result;
  }

  @Override
  public Iterator<Object> executeStream(Agent agent, List<Message> messages) {
    Map<String, Object> body = buildArgs(agent, messages);
    Wire.enableStreaming(body);
    return Http.postSse(providerName(), buildUrl(agent), authHeaders(agent), body);
  }

  @Override
  public Iterator<Object> executeStreamWithContext(
      Agent agent, ModelInvocationRequest request, CancellationToken cancellation) {
    cancellation.throwIfCancelled(
        "streaming execution cancelled before " + providerName() + " provider invocation");
    return Streams.cancellable(executeStream(agent, messagesOf(request)), cancellation);
  }

  @Override
  public List<Message> formatToolMessages(
      Object rawResponse, List<ToolCall> toolCalls, List<String> toolResults, String textContent) {
    return Wire.formatToolMessages(rawResponse, toolCalls, toolResults);
  }

  @Override
  public List<Message> formatStreamToolMessages(
      List<Object> rawChunks,
      List<ToolCall> toolCalls,
      List<String> toolResults,
      String textContent) {
    return Wire.formatStreamToolMessages(rawChunks, toolCalls, toolResults, textContent);
  }

  /** Build the request body without sending it. */
  public Map<String, Object> buildArgs(Agent agent, List<Message> messages) {
    String apiType = apiType(agent);
    if (!"chat".equals(apiType) && !"agent".equals(apiType)) {
      throw InvokerException.execute(
          "Anthropic only supports apiType 'chat', got: " + apiType);
    }
    return Wire.buildChatArgs(agent, messages);
  }

  private static String apiType(Agent agent) {
    if (agent == null || agent.model == null) {
      return "chat";
    }
    String apiType = agent.model.apiType;
    return apiType == null || apiType.isEmpty() ? "chat" : apiType;
  }

  // -------------------------------------------------------- connection

  /**
   * The URL the Messages API lives at for this prompt's connection.
   *
   * <p>Deliberately more forgiving than the Rust reference's Anthropic executor, which reads only
   * {@code connection.endpoint} and always appends {@code /v1/messages}. Honouring {@code
   * ANTHROPIC_BASE_URL} matches the official Anthropic SDKs and the way every other provider here
   * resolves a base URL, and collapsing a duplicate {@code /v1} matches what Rust's own OpenAI
   * executor does — a gateway base is routinely written with the version already on it.
   */
  protected String buildUrl(Agent agent) {
    String endpoint = endpointOf(connection(agent));
    if (endpoint == null || endpoint.isEmpty()) {
      endpoint =
          Environment.lookup("ANTHROPIC_BASE_URL").filter(v -> !v.isEmpty()).orElse(DEFAULT_ENDPOINT);
    }
    String base = Connections.trimTrailingSlashes(endpoint);
    // A proxy base is commonly written with the version already on it; appending another would
    // produce /v1/v1/messages.
    return base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages";
  }

  /** The headers that authenticate and version the request. */
  protected Map<String, String> authHeaders(Agent agent) {
    return Map.of(
        "x-api-key", apiKey(agent),
        "anthropic-version", Wire.ANTHROPIC_VERSION);
  }

  /** Resolve the API key from the prompt's connection, falling back to the environment. */
  protected String apiKey(Agent agent) {
    Connection connection = connection(agent);
    if (connection instanceof ApiKeyConnection apiKey
        && apiKey.apiKey != null
        && !apiKey.apiKey.isEmpty()) {
      return apiKey.apiKey;
    }
    return Environment.lookup("ANTHROPIC_API_KEY")
        .filter(key -> !key.isEmpty())
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "No API key found. Set ANTHROPIC_API_KEY or configure"
                        + " model.connection.apiKey"));
  }

  /** The prompt's connection with any reference followed to the concrete one. */
  protected static Connection connection(Agent agent) {
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
