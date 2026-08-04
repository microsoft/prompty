package com.microsoft.prompty;

import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

/** Helpers for the iterator-shaped streams that executors and processors exchange. */
public final class Streams {

  private Streams() {}

  /** Text and tool calls drained from a processed chunk stream. */
  public record Consumed(List<ToolCall> toolCalls, String text) {}

  /**
   * Release a stream's underlying resources, if it has any.
   *
   * <p>Provider streams sit on a live connection. Java has no destructor to release it, so a stream
   * that is abandoned — cancelled, terminated by a refusal, or simply stopped early — has to be
   * closed explicitly or the connection stays checked out until the garbage collector happens to
   * notice. Streams with nothing to release are unaffected, so callers can close unconditionally.
   */
  public static void close(Object stream) {
    if (stream instanceof AutoCloseable closeable) {
      try {
        closeable.close();
      } catch (Exception e) {
        // Releasing a stream that is already finished with is best-effort: there is no caller left
        // to act on the failure, and raising it would mask whatever ended the stream in the first
        // place.
      }
    }
  }

  /**
   * Wrap a stream so that every advance first observes a cancellation token.
   *
   * <p>A cancelled stream simply reports exhaustion rather than throwing. Cancellation is a normal
   * outcome for a stream — the caller asked for it — and the partial content already yielded stays
   * valid. The source is released on cancellation, since nothing will read from it again.
   */
  public static <T> Iterator<T> cancellable(Iterator<T> source, CancellationToken cancellation) {
    return new ClosingIterator<T>(source) {
      @Override
      public boolean hasNext() {
        if (cancellation.isCancelled()) {
          close();
          return false;
        }
        return source.hasNext();
      }

      @Override
      public T next() {
        if (cancellation.isCancelled()) {
          close();
          throw new NoSuchElementException("stream cancelled");
        }
        return source.next();
      }
    };
  }

  /**
   * An iterator that forwards closure to the stream it wraps.
   *
   * <p>Streams are composed in layers — transport, cancellation, tracing, processing — and the
   * connection to release sits at the bottom. Closing has to travel down the chain, or only the
   * outermost wrapper hears about it and the connection stays open.
   */
  abstract static class ClosingIterator<T> implements Iterator<T>, java.io.Closeable {
    private final Iterator<?> source;
    private boolean closed;

    ClosingIterator(Iterator<?> source) {
      this.source = source;
    }

    @Override
    public void close() {
      if (!closed) {
        closed = true;
        Streams.close(source);
      }
    }
  }

  /**
   * Wrap a stream so every element passes through {@code observer} on its way out.
   *
   * <p>Used to accumulate raw chunks for tracing without buffering the whole stream up front.
   */
  public static <T> Iterator<T> peeking(Iterator<T> source, java.util.function.Consumer<T> observer) {
    return new ClosingIterator<T>(source) {
      @Override
      public boolean hasNext() {
        return source.hasNext();
      }

      @Override
      public T next() {
        T item = source.next();
        observer.accept(item);
        return item;
      }
    };
  }

  /**
   * Drain a processed chunk stream into accumulated text and completed tool calls.
   *
   * <p>Thinking and usage chunks are informational and contribute nothing to the result. An error
   * chunk terminates consumption immediately: the stream is broken from that point on, and
   * continuing would append content the provider never committed to.
   *
   * @param onToken invoked for each text token as it arrives, or null
   */
  public static Consumed consume(
      Iterator<StreamChunk> stream, java.util.function.Consumer<String> onToken) {
    List<ToolCall> toolCalls = new ArrayList<>();
    StringBuilder text = new StringBuilder();

    while (stream.hasNext()) {
      StreamChunk chunk = stream.next();
      if (chunk instanceof TextChunk textChunk) {
        String value = textChunk.value == null ? "" : textChunk.value;
        if (onToken != null) {
          onToken.accept(value);
        }
        text.append(value);
      } else if (chunk instanceof ToolChunk toolChunk) {
        if (toolChunk.toolCall != null) {
          toolCalls.add(toolChunk.toolCall);
        }
      } else if (chunk instanceof ErrorChunk) {
        break;
      }
    }

    return new Consumed(toolCalls, text.toString());
  }

  /**
   * Merge OpenAI-style incremental {@code tool_calls} deltas into completed tool calls.
   *
   * <p>Providers stream a tool call in pieces: the identifier and name arrive once, then the
   * arguments accumulate across many chunks. Deltas are keyed by their {@code index}, and the
   * resulting calls are returned in index order so the sequence matches what the model requested.
   */
  public static List<ToolCall> mergeToolCallDeltas(List<Object> chunks) {
    Map<Integer, ToolCall> byIndex = new java.util.TreeMap<>();
    Map<Integer, StringBuilder> arguments = new LinkedHashMap<>();

    for (Object chunk : chunks) {
      List<Object> deltas = toolCallDeltas(chunk);
      for (Object raw : deltas) {
        if (!(raw instanceof Map<?, ?> delta)) {
          continue;
        }
        int index = intValue(delta.get("index"));
        ToolCall call = byIndex.computeIfAbsent(index, key -> new ToolCall());
        StringBuilder args = arguments.computeIfAbsent(index, key -> new StringBuilder());

        Object id = delta.get("id");
        if (id instanceof String s && !s.isEmpty()) {
          call.id = s;
        }
        if (delta.get("function") instanceof Map<?, ?> function) {
          if (function.get("name") instanceof String name && !name.isEmpty()) {
            call.name = name;
          }
          if (function.get("arguments") instanceof String argument) {
            args.append(argument);
          }
        }
      }
    }

    List<ToolCall> result = new ArrayList<>(byIndex.size());
    for (Map.Entry<Integer, ToolCall> entry : byIndex.entrySet()) {
      ToolCall call = entry.getValue();
      StringBuilder args = arguments.get(entry.getKey());
      call.arguments = args == null ? "" : args.toString();
      result.add(call);
    }
    return result;
  }

  /** Concatenate {@code choices[0].delta.content} across raw OpenAI-style chunks. */
  public static String collectDeltaText(List<Object> chunks) {
    StringBuilder text = new StringBuilder();
    for (Object chunk : chunks) {
      Object content = pointer(chunk, "choices", 0, "delta", "content");
      if (content instanceof String s) {
        text.append(s);
      }
    }
    return text.toString();
  }

  @SuppressWarnings("unchecked")
  private static List<Object> toolCallDeltas(Object chunk) {
    Object value = pointer(chunk, "choices", 0, "delta", "tool_calls");
    return value instanceof List<?> list ? (List<Object>) list : List.of();
  }

  /**
   * Walk a JSON-shaped tree by a mixed path of map keys and list indices.
   *
   * @return the value at that path, or null if any step is absent or the wrong shape
   */
  public static Object pointer(Object root, Object... path) {
    Object current = root;
    for (Object step : path) {
      if (current == null) {
        return null;
      }
      if (step instanceof Integer index) {
        if (!(current instanceof List<?> list) || index < 0 || index >= list.size()) {
          return null;
        }
        current = list.get(index);
      } else {
        if (!(current instanceof Map<?, ?> map)) {
          return null;
        }
        current = map.get(step);
      }
    }
    return current;
  }

  private static int intValue(Object value) {
    return value instanceof Number number ? number.intValue() : 0;
  }
}
