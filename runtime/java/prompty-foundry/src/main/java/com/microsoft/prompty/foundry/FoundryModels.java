package com.microsoft.prompty.foundry;

import com.microsoft.prompty.Discovery;
import com.microsoft.prompty.model.ModelInfo;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Maps Foundry's model listings onto the provider-neutral contract.
 *
 * <p>Foundry answers from two different endpoints with two different shapes, so the mapping is split
 * accordingly. Both are pure functions over a decoded payload, which is what lets the shared
 * discovery vectors exercise them without a network or a token.
 */
public final class FoundryModels {

  private static final String PROVIDER = "foundry";

  private FoundryModels() {}

  /**
   * Map one deployment entry onto the provider-neutral contract.
   *
   * <p>Two shapes reach this method. The data plane ({@code /deployments?api-version=v1}) returns a
   * flat object with {@code modelName}, {@code modelPublisher} and top-level {@code capabilities};
   * the ARM management plane nests the same facts under {@code properties.model}. Rather than ask
   * callers to tell the two apart, each field is looked for in every place it is known to appear,
   * flat form first.
   */
  public static ModelInfo deploymentToModelInfo(Object raw) {
    ModelInfo info = new ModelInfo();
    if (!(raw instanceof Map<?, ?> map)) {
      return info;
    }

    Map<?, ?> properties = asMap(map.get("properties"));
    Map<?, ?> model = asMap(properties.get("model"));
    // The first capability block that is *present* wins, even when it is empty — an endpoint that
    // deliberately reports no capabilities should not have a sibling block substituted for it.
    Map<?, ?> capabilities = Map.of();
    for (Map<?, ?> candidate : List.of(properties, model, map)) {
      if (candidate.containsKey("capabilities")) {
        capabilities = asMap(candidate.get("capabilities"));
        break;
      }
    }

    // The id is the one field a caller cannot do without, so an entry that names none still round
    // trips as an empty string rather than vanishing from the saved shape.
    info.id = firstString(string(map.get("name")), "");
    info.displayName = firstString(string(map.get("modelName")), string(model.get("name")));
    // Everything on this endpoint is served by Azure, so an entry that names no publisher is still
    // attributable; leaving it null would lose that.
    String publisher =
        firstString(string(map.get("modelPublisher")), string(model.get("publisher")));
    info.ownedBy = publisher == null ? "azure" : publisher;
    info.contextWindow =
        firstInt(
            integer(capabilities, "maxContextLength", "contextWindow", "context_length"),
            integer(model, "maxContextLength"),
            integer(map, "maxContextLength"));
    info.inputModalities =
        strings(capabilities, "inputModalities", "input_modalities", "supportedInputModalities");
    info.outputModalities =
        strings(capabilities, "outputModalities", "output_modalities", "supportedOutputModalities");
    info.additionalProperties = copy(map);

    Discovery.enrich(PROVIDER, info);
    return info;
  }

  /**
   * Map one Azure OpenAI model-catalog entry onto the provider-neutral contract.
   *
   * <p>The catalog describes models rather than deployments, so it carries neither a display name
   * nor modality information; those are left for the shared dataset to fill.
   */
  public static ModelInfo catalogModelToModelInfo(Object raw) {
    ModelInfo info = new ModelInfo();
    if (!(raw instanceof Map<?, ?> map)) {
      return info;
    }
    info.id = firstString(string(map.get("id")), "");
    info.ownedBy = string(map.get("owned_by"));
    info.contextWindow = integer(map, "maxContextLength");
    info.additionalProperties = copy(map);

    Discovery.enrich(PROVIDER, info);
    return info;
  }

  /**
   * Read an integer from the first of {@code keys} that carries one.
   *
   * <p>Capability values arrive as numbers from ARM and as strings from the data plane, so both are
   * accepted.
   */
  private static Integer integer(Map<?, ?> source, String... keys) {
    for (String key : keys) {
      Object value = source.get(key);
      if (value instanceof Number number) {
        return number.intValue();
      }
      if (value instanceof String text) {
        try {
          return Integer.valueOf(text.trim());
        } catch (NumberFormatException ignored) {
          // Not a number after all; keep looking under the remaining keys.
        }
      }
    }
    return null;
  }

  /**
   * Read a string list from the first of {@code keys} that carries one.
   *
   * <p>Modalities arrive as a JSON array from ARM and as a comma-separated string from the data
   * plane, so both are accepted.
   */
  private static List<String> strings(Map<?, ?> source, String... keys) {
    for (String key : keys) {
      Object value = source.get(key);
      if (value instanceof Iterable<?> items) {
        List<String> result = new ArrayList<>();
        for (Object item : items) {
          if (item instanceof String text) {
            result.add(text);
          }
        }
        return result;
      }
      if (value instanceof String text) {
        List<String> result = new ArrayList<>();
        for (String part : text.split(",")) {
          String trimmed = part.trim();
          if (!trimmed.isEmpty()) {
            result.add(trimmed);
          }
        }
        return result;
      }
    }
    return null;
  }

  private static Map<?, ?> asMap(Object value) {
    return value instanceof Map<?, ?> map ? map : Map.of();
  }

  /**
   * A string member, kept verbatim.
   *
   * <p>An empty string is deliberately preserved rather than folded into {@code null}: the
   * reference runtime distinguishes "the endpoint sent an empty publisher" from "the endpoint sent
   * no publisher at all", and only the latter earns the {@code azure} fallback.
   */
  private static String string(Object value) {
    return value instanceof String text ? text : null;
  }

  private static String firstString(String... values) {
    for (String value : values) {
      if (value != null) {
        return value;
      }
    }
    return null;
  }

  private static Integer firstInt(Integer... values) {
    for (Integer value : values) {
      if (value != null) {
        return value;
      }
    }
    return null;
  }

  private static Map<String, Object> copy(Map<?, ?> source) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : source.entrySet()) {
      result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
  }
}
