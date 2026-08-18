package com.microsoft.prompty.openai;

import com.microsoft.prompty.Discovery;
import com.microsoft.prompty.Environment;
import com.microsoft.prompty.Http;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.ModelLister;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Lists the models an OpenAI connection can reach. */
public final class OpenAIModelLister implements ModelLister {

  private static final String PROVIDER = "openai";

  /**
   * Map one raw {@code /v1/models} entry onto the provider-neutral contract.
   *
   * <p>This is the only place the OpenAI listing wire format is interpreted, and the shared
   * discovery vectors exercise it directly so every runtime agrees on the result.
   *
   * <p>OpenAI reports an id and an owner and nothing else, so capabilities come from the shared
   * dataset. That fill is provider-optional under the {@code ModelInfo} contract, which is why the
   * discovery vectors deliberately use ids the dataset does not know: it leaves the wire mapping
   * visible on its own.
   */
  public static ModelInfo modelInfoFromWire(Object raw) {
    ModelInfo info = new ModelInfo();
    if (!(raw instanceof Map<?, ?> map)) {
      return info;
    }
    info.id = map.get("id") instanceof String id ? id : "";
    info.ownedBy = map.get("owned_by") instanceof String owner ? owner : null;
    info.additionalProperties = copy(map);
    Discovery.enrich(PROVIDER, info);
    return info;
  }

  /** Call {@code GET /v1/models} and map every entry it returns. */
  @Override
  public List<ModelInfo> listModels(Object connection) {
    Map<?, ?> config = connection instanceof Map<?, ?> map ? map : Map.of();
    requireKeyConnection(config);

    Object body =
        Http.getJson(
            PROVIDER,
            modelsUrl(config),
            Map.of("Authorization", "Bearer " + apiKey(config)));

    List<ModelInfo> models = new ArrayList<>();
    if (body instanceof Map<?, ?> map && map.get("data") instanceof Iterable<?> data) {
      for (Object entry : data) {
        models.add(modelInfoFromWire(entry));
      }
    }
    return models;
  }

  static String modelsUrl(Map<?, ?> connection) {
    String endpoint = text(connection.get("endpoint"));
    if (endpoint.isEmpty()) {
      endpoint = Environment.lookup("OPENAI_BASE_URL").orElse("");
    }
    if (endpoint.isEmpty()) {
      endpoint = "https://api.openai.com";
    }

    String base = endpoint;
    while (base.endsWith("/")) {
      base = base.substring(0, base.length() - 1);
    }
    // An endpoint that already names the API version would otherwise produce /v1/v1/models.
    return base.endsWith("/v1") ? base + "/models" : base + "/v1/models";
  }

  static String apiKey(Map<?, ?> connection) {
    String key = text(connection.get("apiKey"));
    if (key.isEmpty()) {
      key = text(connection.get("api_key"));
    }
    if (key.isEmpty()) {
      key = Environment.lookup("OPENAI_API_KEY").orElse("");
    }
    if (key.isEmpty()) {
      throw InvokerException.execute(
          "No API key found. Set OPENAI_API_KEY or configure connection.apiKey");
    }
    return key;
  }

  private static void requireKeyConnection(Map<?, ?> connection) {
    String kind = text(connection.get("kind"));
    if (!"key".equals(kind)) {
      throw InvokerException.execute(
          "Connection kind '" + kind + "' is not supported for OpenAI model listing. Use 'key'.");
    }
  }

  private static String text(Object value) {
    return value instanceof String s ? s : "";
  }

  private static Map<String, Object> copy(Map<?, ?> source) {
    Map<String, Object> result = new java.util.LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : source.entrySet()) {
      result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
  }
}
