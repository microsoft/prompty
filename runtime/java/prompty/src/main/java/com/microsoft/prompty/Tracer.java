package com.microsoft.prompty;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;

/**
 * Structured tracing for pipeline stages.
 *
 * <p>A span is opened for each stage, key/value observations are emitted into it, and it closes when
 * the stage finishes. Registered listeners receive completed spans; with no listener registered the
 * whole facility costs a field read and a null check, so instrumentation can stay in the hot path
 * unconditionally.
 *
 * <p>Spans nest per thread, so a listener can reconstruct the call tree from {@link Span#depth()}.
 */
public final class Tracer {

  private static final List<BiConsumer<String, Map<String, Object>>> LISTENERS =
      new CopyOnWriteArrayList<>();

  private static final ThreadLocal<Integer> DEPTH = ThreadLocal.withInitial(() -> 0);

  private Tracer() {}

  /** Register a listener invoked with the name and observations of each completed span. */
  public static void addListener(BiConsumer<String, Map<String, Object>> listener) {
    LISTENERS.add(listener);
  }

  /** Remove a previously registered listener. */
  public static void removeListener(BiConsumer<String, Map<String, Object>> listener) {
    LISTENERS.remove(listener);
  }

  /** Remove every registered listener. */
  public static void clearListeners() {
    LISTENERS.clear();
  }

  /** Whether any listener is registered. Callers may skip building costly trace values if not. */
  public static boolean isEnabled() {
    return !LISTENERS.isEmpty();
  }

  /** Open a span. The caller must close it, ideally with try-with-resources. */
  public static Span start(String name) {
    return new Span(name);
  }

  /** A single traced stage. */
  public static final class Span implements AutoCloseable {

    private final String name;
    private final int depth;
    private final Map<String, Object> observations;
    private boolean closed;

    private Span(String name) {
      this.name = name;
      this.depth = DEPTH.get();
      this.observations = isEnabled() ? new LinkedHashMap<>() : null;
      DEPTH.set(this.depth + 1);
    }

    /** The nesting depth of this span, counting from zero at the outermost. */
    public int depth() {
      return depth;
    }

    /** Record an observation. Ignored when no listener is registered. */
    public Span emit(String key, Object value) {
      if (observations != null) {
        observations.put(key, value);
      }
      return this;
    }

    /** Record a failure and its message. */
    public Span error(Throwable error) {
      return emit("error", error.getMessage());
    }

    @Override
    public void close() {
      if (closed) {
        return;
      }
      closed = true;
      DEPTH.set(depth);
      if (observations == null) {
        return;
      }
      // Copy first: a listener must not be able to mutate what later listeners see.
      Map<String, Object> snapshot = new LinkedHashMap<>(observations);
      snapshot.put("__depth", depth);
      for (BiConsumer<String, Map<String, Object>> listener : new ArrayList<>(LISTENERS)) {
        try {
          listener.accept(name, snapshot);
        } catch (RuntimeException ignored) {
          // A telemetry sink must never be able to fail an operation that already succeeded, nor
          // stop the sinks registered after it from seeing the span.
        }
      }
    }
  }
}
