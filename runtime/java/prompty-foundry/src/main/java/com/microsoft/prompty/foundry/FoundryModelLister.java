package com.microsoft.prompty.foundry;

import com.microsoft.prompty.Environment;
import com.microsoft.prompty.Http;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.ModelLister;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Lists the models a Foundry or Azure OpenAI connection can reach.
 *
 * <p>The two connection kinds answer different questions, so they hit different services. A {@code
 * foundry} project connection lists <em>deployments</em>, because a deployment name is what a user
 * actually writes in {@code model.id} — the underlying model catalog is not directly invokable
 * there. An Azure OpenAI {@code key} connection has no deployment sub-resource on its data plane,
 * so it lists the lower-level model catalog instead.
 *
 * <p>The wire-to-{@link ModelInfo} mapping itself lives in {@link FoundryModels} and is exercised
 * by the shared discovery vectors; this class is only the transport and dispatch around it.
 */
public final class FoundryModelLister implements ModelLister {

  private static final String PROVIDER = "foundry";

  /**
   * The catalog API version used when a connection does not pin one.
   *
   * <p>Kept identical to the Rust runtime so both report the same catalog for the same account.
   */
  static final String DEFAULT_API_VERSION = "2025-04-01-preview";

  @Override
  public List<ModelInfo> listModels(Object connection) {
    Map<?, ?> config = connection instanceof Map<?, ?> map ? map : Map.of();
    String kind = text(config.get("kind"));
    return switch (kind) {
      case "foundry" -> listDeployments(config);
      case "key" -> listCatalog(config);
      default ->
          throw InvokerException.execute(
              "Connection kind '"
                  + kind
                  + "' is not supported for Foundry model listing. Use 'foundry' for project"
                  + " deployments or 'key' for Azure OpenAI model catalogs.");
    };
  }

  /** Call the project data plane's deployment list and map every entry it returns. */
  private static List<ModelInfo> listDeployments(Map<?, ?> connection) {
    Object body =
        Http.getJson(
            PROVIDER,
            deploymentsUrl(connection),
            Map.of("Authorization", "Bearer " + deploymentToken(connection)));
    return mapEntries(body, "value", FoundryModels::deploymentToModelInfo);
  }

  /** Call the Azure OpenAI catalog and map every entry it returns. */
  private static List<ModelInfo> listCatalog(Map<?, ?> connection) {
    Object body =
        Http.getJson(PROVIDER, catalogUrl(connection), Map.of("api-key", catalogKey(connection)));
    return mapEntries(body, "data", FoundryModels::catalogModelToModelInfo);
  }

  static String deploymentsUrl(Map<?, ?> connection) {
    String endpoint = trimTrailingSlashes(text(connection.get("endpoint")));
    if (endpoint.isEmpty()) {
      throw InvokerException.execute(
          "Foundry connection requires a non-empty endpoint to list deployments.");
    }
    return endpoint + "/deployments?api-version=v1";
  }

  static String catalogUrl(Map<?, ?> connection) {
    String endpoint = text(connection.get("endpoint"));
    if (endpoint.isEmpty()) {
      endpoint = Environment.lookup("AZURE_OPENAI_ENDPOINT").orElse("");
    }
    endpoint = trimTrailingSlashes(endpoint);
    if (endpoint.isEmpty()) {
      throw InvokerException.execute("Azure endpoint is required to list model catalog entries.");
    }

    String apiVersion = text(connection.get("apiVersion"));
    if (apiVersion.isEmpty()) {
      apiVersion = DEFAULT_API_VERSION;
    }
    return endpoint + "/openai/models?api-version=" + apiVersion;
  }

  /**
   * The bearer token a deployment listing authenticates with.
   *
   * <p>A caller-supplied token wins. Failing that this would need an ambient Entra credential,
   * which this runtime does not carry a dependency for — so it says so rather than sending an
   * unauthenticated request and reporting whatever 401 comes back.
   */
  static String deploymentToken(Map<?, ?> connection) {
    return FoundryAuth.bearerToken(connection)
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "Foundry deployment listing requires a bearer token. Set connection.apiKey to"
                        + " an Entra ID token, or acquire one via the device code flow."));
  }

  static String catalogKey(Map<?, ?> connection) {
    return FoundryAuth.apiKey(connection)
        .or(() -> Environment.lookup("AZURE_OPENAI_API_KEY").filter(key -> !key.isBlank()))
        .orElseThrow(
            () ->
                InvokerException.execute(
                    "Azure API key is required to list model catalog entries."));
  }

  private static List<ModelInfo> mapEntries(
      Object body, String key, java.util.function.Function<Object, ModelInfo> mapper) {
    List<ModelInfo> models = new ArrayList<>();
    // A response missing the collection is an empty catalog, not a failure: a fresh project with no
    // deployments legitimately answers this way.
    if (body instanceof Map<?, ?> map && map.get(key) instanceof Iterable<?> entries) {
      for (Object entry : entries) {
        models.add(mapper.apply(entry));
      }
    }
    return models;
  }

  private static String trimTrailingSlashes(String value) {
    String result = value;
    while (result.endsWith("/")) {
      result = result.substring(0, result.length() - 1);
    }
    return result;
  }

  private static String text(Object value) {
    return value instanceof String s ? s : "";
  }
}
