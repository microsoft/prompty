package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Summarizes messages that context trimming is about to drop.
 *
 * <p>Trimming alone loses information. Compaction gives that loss somewhere to go: the dropped
 * messages are summarized and the summary replaces them, so the model keeps the gist of a long
 * conversation without carrying its full text.
 *
 * <p>Compaction is best-effort by design. If the summarizer fails or returns nothing usable, the
 * turn keeps the default mechanical summary and continues — a failed summarization must never fail
 * the turn it was trying to help.
 */
@FunctionalInterface
public interface Compaction {

  /**
   * Summarize dropped messages.
   *
   * @return the summary text, or null/blank to keep the default summary
   */
  String summarize(List<Message> dropped);

  /**
   * Summarize by invoking a {@code .prompty} file with the dropped messages as its {@code messages}
   * input.
   */
  static Compaction fromPrompty(Path path) {
    return dropped -> {
      Map<String, Object> inputs = new LinkedHashMap<>();
      inputs.put("messages", Context.formatDroppedMessages(dropped));
      Object result = Pipeline.invoke(path, inputs);
      return result instanceof String text ? text : null;
    };
  }

  /** Summarize by invoking a {@code .prompty} file at {@code path}. */
  static Compaction fromPrompty(String path) {
    return fromPrompty(Path.of(path));
  }
}
