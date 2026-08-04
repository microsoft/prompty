package com.microsoft.prompty.foundry;

import com.microsoft.prompty.Connections;
import com.microsoft.prompty.Environment;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.ModelOptions;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.openai.OpenAIExecutor;
import java.util.Map;

/**
 * Sends requests to Azure OpenAI and Foundry endpoints.
 *
 * <p>The wire format is OpenAI's, so this builds on {@link OpenAIExecutor} and changes only the two
 * things Azure does differently: where the request goes and how it is authenticated.
 *
 * <p>Two connection shapes are supported. A {@code foundry} connection addresses the OpenAI/v1
 * surface directly and authenticates with a bearer token. Every other kind addresses a named
 * deployment and authenticates with the {@code api-key} header, which is Azure's own scheme rather
 * than {@code Authorization: Bearer}.
 */
public class FoundryExecutor extends OpenAIExecutor {

  /** The API version used when the prompt does not name one. */
  static final String DEFAULT_API_VERSION = "2025-04-01-preview";

  private static final String FOUNDRY_KIND = "foundry";

  @Override
  protected String providerName() {
    return "foundry";
  }

  @Override
  protected String buildUrl(Prompty agent, String path) {
    Connection connection = connection(agent);
    String operation = azureOperation(path);
    String endpoint = Connections.trimTrailingSlashes(endpointOf(agent, connection));

    // A Foundry endpoint already points at the OpenAI/v1 surface, which routes by the model named
    // in the body rather than by a deployment in the path.
    if (isFoundry(connection)) {
      return endpoint + "/" + operation;
    }
    return endpoint
        + "/openai/deployments/"
        + deploymentOf(agent)
        + "/"
        + operation
        + "?api-version="
        + apiVersionOf(agent);
  }

  @Override
  protected Map<String, String> authHeaders(Prompty agent) {
    Connection connection = connection(agent);

    if (isFoundry(connection)) {
      String token =
          FoundryAuth.bearerToken(connection)
              .or(() -> Environment.lookup("AZURE_INFERENCE_CREDENTIAL").filter(v -> !v.isEmpty()))
              .orElseThrow(
                  () ->
                      InvokerException.execute(
                          "Foundry connection requires a bearer token. Set"
                              + " AZURE_INFERENCE_CREDENTIAL or configure a token on"
                              + " model.connection"));
      return Map.of("Authorization", "Bearer " + token);
    }

    String key =
        FoundryAuth.apiKey(connection)
            .or(() -> Environment.lookup("AZURE_OPENAI_API_KEY").filter(v -> !v.isEmpty()))
            .orElseThrow(
                () ->
                    InvokerException.execute(
                        "No Azure API key found. Set AZURE_OPENAI_API_KEY or configure"
                            + " model.connection.apiKey"));
    // Azure authenticates with its own header rather than an Authorization bearer.
    return Map.of("api-key", key);
  }

  // -------------------------------------------------------------------- url

  /**
   * The Azure path for an OpenAI operation.
   *
   * <p>The inherited executor decides which operations an apiType permits and hands the OpenAI path
   * down; this maps the ones Azure serves and rejects the rest. Azure has no Responses surface, so
   * a prompt asking for one is refused here rather than sent somewhere that would 404.
   */
  private static String azureOperation(String path) {
    return switch (path) {
      case "/v1/chat/completions" -> "chat/completions";
      case "/v1/embeddings" -> "embeddings";
      case "/v1/images/generations" -> "images/generations";
      case "/v1/responses" -> throw InvokerException.execute(
          "Unsupported apiType for Azure: responses");
      default -> throw InvokerException.execute("Unsupported apiType for Azure: " + path);
    };
  }

  /**
   * The endpoint to address: the prompt's connection, then the environment.
   *
   * <p>A Foundry project endpoint names a project rather than an inference surface, so it is
   * rewritten before use.
   */
  private static String endpointOf(Prompty agent, Connection connection) {
    String endpoint = endpointOf(connection);
    if (endpoint != null && !endpoint.isEmpty()) {
      return isFoundry(connection) ? stripProjectPath(endpoint) : endpoint;
    }
    return Environment.lookup("AZURE_OPENAI_ENDPOINT")
        .filter(value -> !value.isEmpty())
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "No Azure OpenAI endpoint found. Set AZURE_OPENAI_ENDPOINT or configure"
                        + " model.connection.endpoint"));
  }

  /**
   * Rewrite a Foundry project endpoint as its OpenAI/v1 base URL.
   *
   * <p>A project endpoint looks like {@code https://resource.services.ai.azure.com/api/projects/p},
   * but inference is served from {@code https://resource.openai.azure.com/openai/v1}. Anything that
   * does not look like a project endpoint is returned with only the project path removed, so an
   * endpoint that already points at the inference surface is left alone.
   */
  static String stripProjectPath(String endpoint) {
    int projects = endpoint.indexOf("/api/projects");
    String base =
        Connections.trimTrailingSlashes(projects >= 0 ? endpoint.substring(0, projects) : endpoint);

    int schemeEnd = base.indexOf("://");
    if (schemeEnd < 0) {
      return base;
    }
    String scheme = base.substring(0, schemeEnd);
    String rest = base.substring(schemeEnd + 3);
    int slash = rest.indexOf('/');
    String authority = slash >= 0 ? rest.substring(0, slash) : rest;

    String host = authority;
    String port = "";
    int colon = authority.lastIndexOf(':');
    if (colon >= 0 && isAllDigits(authority.substring(colon + 1))) {
      host = authority.substring(0, colon);
      port = authority.substring(colon);
    }

    String suffix = ".services.ai.azure.com";
    if (host.endsWith(suffix)) {
      host = host.substring(0, host.length() - suffix.length()) + ".openai.azure.com";
    }
    return scheme + "://" + host + port + "/openai/v1";
  }

  private static boolean isAllDigits(String value) {
    if (value.isEmpty()) {
      return false;
    }
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c < '0' || c > '9') {
        return false;
      }
    }
    return true;
  }

  /** The deployment to address: the prompt's model id, then the environment. */
  private static String deploymentOf(Prompty agent) {
    String id = agent == null || agent.model == null ? null : agent.model.id;
    if (id != null && !id.isEmpty()) {
      return id;
    }
    return Environment.lookup("AZURE_OPENAI_DEPLOYMENT")
        .filter(value -> !value.isEmpty())
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "No deployment name found. Set model.id or AZURE_OPENAI_DEPLOYMENT"));
  }

  /** The API version the prompt asked for, or the default. */
  private static String apiVersionOf(Prompty agent) {
    ModelOptions options = agent == null || agent.model == null ? null : agent.model.options;
    if (options != null
        && options.additionalProperties != null
        && options.additionalProperties.get("apiVersion") instanceof String version
        && !version.isEmpty()) {
      return version;
    }
    return DEFAULT_API_VERSION;
  }

  private static boolean isFoundry(Connection connection) {
    return connection != null && FOUNDRY_KIND.equals(connection.kind);
  }
}
