package com.microsoft.prompty;

import com.microsoft.prompty.model.TypraJson;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Transport for structured (schema-shaped) results.
 *
 * <p>When an agent declares outputs, its processed result is data rather than prose. Wrapping it
 * preserves the exact JSON the model produced alongside the parsed form, so a later {@link
 * #cast(Object, Class)} can deserialize losslessly instead of re-serializing an already-lossy
 * intermediate. Callers who just want the value never see the wrapper — the pipeline unwraps before
 * returning.
 */
public final class StructuredResult {

  /** Marker key identifying a wrapped structured result in transport form. */
  public static final String MARKER = "__prompty_structured";

  private final Object data;
  private final String rawJson;

  public StructuredResult(Object data, String rawJson) {
    this.data = data;
    this.rawJson = rawJson;
  }

  /** The parsed structured value. */
  public Object data() {
    return data;
  }

  /** The exact JSON text the value was parsed from. */
  public String rawJson() {
    return rawJson;
  }

  /** Whether a pipeline value is a wrapped structured result. */
  public static boolean isWrapped(Object value) {
    return value instanceof Map<?, ?> map && map.containsKey(MARKER);
  }

  /** Wrap a structured value for pipeline transport. */
  public Map<String, Object> toTransport() {
    Map<String, Object> transport = new LinkedHashMap<>();
    transport.put(MARKER, Boolean.TRUE);
    transport.put("data", data);
    transport.put("raw_json", rawJson);
    return transport;
  }

  /** Reconstruct a structured result from transport form, or null if it is not one. */
  public static StructuredResult fromTransport(Object value) {
    if (!(value instanceof Map<?, ?> map) || !map.containsKey(MARKER)) {
      return null;
    }
    Object raw = map.get("raw_json");
    return new StructuredResult(map.get("data"), raw instanceof String s ? s : null);
  }

  /**
   * Wrap {@code result} for transport when the agent declares outputs and the result is structured.
   *
   * <p>A scalar result is never wrapped: there is nothing to preserve that stringifying would lose.
   */
  public static Object wrapIfNeeded(com.microsoft.prompty.model.Agent agent, Object result) {
    boolean hasOutputs = agent != null && agent.outputs != null && !agent.outputs.isEmpty();
    if (!hasOutputs || !(result instanceof Map<?, ?> || result instanceof List<?>)) {
      return result;
    }
    return new StructuredResult(result, TypraJson.stringify(result)).toTransport();
  }

  /** Unwrap transport form to its data, or return the value unchanged. */
  public static Object unwrap(Object value) {
    StructuredResult wrapped = fromTransport(value);
    return wrapped == null ? value : wrapped.data;
  }

  /**
   * Deserialize a pipeline value into a generated model type.
   *
   * <p>Accepts a wrapped structured result, a JSON string, or an already-parsed tree. The target
   * must be a generated model class — that is what makes this a projection of the canonical model
   * rather than a second, hand-rolled deserializer.
   *
   * @throws InvokerException with {@link InvokerException.Kind#PROCESS} if the value cannot be
   *     deserialized into {@code type}
   */
  public static <T> T cast(Object value, Class<T> type) {
    try {
      Object tree = value;
      StructuredResult wrapped = fromTransport(value);
      if (wrapped != null) {
        tree = wrapped.rawJson != null ? TypraJson.parse(wrapped.rawJson) : wrapped.data;
      } else if (value instanceof String text) {
        tree = TypraJson.parse(text);
      }

      java.lang.reflect.Method load =
          type.getMethod("load", Object.class, com.microsoft.prompty.model.LoadContext.class);
      return type.cast(load.invoke(null, tree, new com.microsoft.prompty.model.LoadContext()));
    } catch (NoSuchMethodException e) {
      throw InvokerException.process(
          "Cannot cast to " + type.getName() + ": not a generated model type");
    } catch (ReflectiveOperationException e) {
      Throwable cause = e.getCause() == null ? e : e.getCause();
      throw InvokerException.process("Cast to " + type.getName() + " failed: " + cause.getMessage());
    }
  }
}
