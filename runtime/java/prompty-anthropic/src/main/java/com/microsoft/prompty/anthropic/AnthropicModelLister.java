package com.microsoft.prompty.anthropic;

import com.microsoft.prompty.Discovery;
import com.microsoft.prompty.Environment;
import com.microsoft.prompty.Http;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.ModelLister;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Lists the models an Anthropic connection can reach. */
public final class AnthropicModelLister implements ModelLister {

  private static final String PROVIDER = "anthropic";

  /** The API version header, matching the executor. */
  private static final String VERSION = "2023-06-01";

  /** How many entries to ask for per page; the API caps this. */
  private static final int PAGE_SIZE = 100;

  /**
   * A page cursor can only follow a page, so a run of pages is bounded by how many the provider is
   * willing to serve. This caps it independently, so a provider that kept reporting more — or a
   * cursor that stopped advancing — cannot spin forever.
   */
  private static final int MAX_PAGES = 100;

  /**
   * Map one raw {@code /v1/models} entry onto the provider-neutral contract.
   *
   * <p>This is the only place the Anthropic listing wire format is interpreted, and the shared
   * discovery vectors exercise it directly so every runtime agrees on the result.
   *
   * <p>Anthropic reports capabilities itself, so the shared dataset only fills what a given entry
   * omitted. The owner is not on the wire at all — every model on this endpoint is Anthropic's — so
   * it is supplied here to keep the field populated the way other providers populate it.
   */
  public static ModelInfo modelInfoFromWire(Object raw) {
    ModelInfo info = new ModelInfo();
    if (!(raw instanceof Map<?, ?> map)) {
      return info;
    }
    info.id = map.get("id") instanceof String id ? id : "";
    info.displayName = map.get("display_name") instanceof String name ? name : null;
    info.ownedBy = PROVIDER;
    info.contextWindow = map.get("context_length") instanceof Number n ? n.intValue() : null;
    info.inputModalities = strings(map.get("input_modalities"));
    info.outputModalities = strings(map.get("output_modalities"));
    info.additionalProperties = copy(map);
    Discovery.enrich(PROVIDER, info);
    return info;
  }

  /** Walk every page of {@code GET /v1/models} and map the entries. */
  @Override
  public List<ModelInfo> listModels(Object connection) {
    Map<?, ?> config = connection instanceof Map<?, ?> map ? map : Map.of();
    requireKeyConnection(config);

    String base = modelsUrl(config);
    Map<String, String> headers =
        Map.of("x-api-key", apiKey(config), "anthropic-version", VERSION);

    List<ModelInfo> models = new ArrayList<>();
    String after = null;
    for (int page = 0; page < MAX_PAGES; page++) {
      String url = base + "?limit=" + PAGE_SIZE;
      if (after != null) {
        url += "&after_id=" + URLEncoder.encode(after, StandardCharsets.UTF_8);
      }

      Object body = Http.getJson(PROVIDER, url, headers);
      if (!(body instanceof Map<?, ?> map)) {
        break;
      }
      if (map.get("data") instanceof Iterable<?> data) {
        for (Object entry : data) {
          models.add(modelInfoFromWire(entry));
        }
      }
      if (!Boolean.TRUE.equals(map.get("has_more"))) {
        break;
      }
      // Without a cursor there is no way to ask for the next page, so stop rather than re-request
      // the one just read.
      if (!(map.get("last_id") instanceof String cursor) || cursor.isEmpty()) {
        break;
      }
      after = cursor;
    }
    return models;
  }

  static String modelsUrl(Map<?, ?> connection) {
    String endpoint = text(connection.get("endpoint"));
    if (endpoint.isEmpty()) {
      endpoint = "https://api.anthropic.com";
    }
    String base = endpoint;
    while (base.endsWith("/")) {
      base = base.substring(0, base.length() - 1);
    }
    return base + "/v1/models";
  }

  static String apiKey(Map<?, ?> connection) {
    String key = text(connection.get("apiKey"));
    if (key.isEmpty()) {
      key = text(connection.get("api_key"));
    }
    if (key.isEmpty()) {
      key = Environment.lookup("ANTHROPIC_API_KEY").orElse("");
    }
    if (key.isEmpty()) {
      throw InvokerException.execute(
          "No API key found. Set ANTHROPIC_API_KEY or configure connection.apiKey");
    }
    return key;
  }

  private static void requireKeyConnection(Map<?, ?> connection) {
    String kind = text(connection.get("kind"));
    if (!"key".equals(kind)) {
      throw InvokerException.execute(
          "Connection kind '" + kind + "' is not supported for Anthropic model listing. Use 'key'.");
    }
  }

  private static List<String> strings(Object value) {
    if (!(value instanceof Iterable<?> items)) {
      return null;
    }
    List<String> result = new ArrayList<>();
    for (Object item : items) {
      if (item instanceof String text) {
        result.add(text);
      }
    }
    return result;
  }

  private static String text(Object value) {
    return value instanceof String s ? s : "";
  }

  private static Map<String, Object> copy(Map<?, ?> source) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : source.entrySet()) {
      result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
  }
}
