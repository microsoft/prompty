package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.EventJournalWriter;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.SessionEvent;
import com.microsoft.prompty.model.SessionSummary;
import com.microsoft.prompty.model.TurnEvent;
import com.microsoft.prompty.model.TypraJson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Appends replayable journal records as newline-delimited JSON.
 *
 * <p>One record per line means a journal is still readable after a crash mid-write, and a replay
 * can be graded by comparing lines rather than parsing a whole document that may never have been
 * closed.
 *
 * <p>Every method reports success rather than throwing. Journalling is observation: a turn that
 * cannot be written down still happened, and failing the turn because of it would trade a
 * recoverable gap in the record for an unrecoverable loss of work.
 */
public final class JsonlEventJournalWriter implements EventJournalWriter {

  private final Path path;
  private final Object lock = new Object();
  private boolean closed;

  public JsonlEventJournalWriter(Path path) {
    this.path = path;
    Path parent = path.getParent();
    if (parent != null) {
      try {
        Files.createDirectories(parent);
      } catch (IOException ignored) {
        // Reported by the first append that fails; there is nothing useful to do here.
      }
    }
  }

  /** The file this writer appends to. */
  public Path path() {
    return path;
  }

  @Override
  public Boolean appendTurn(TurnEvent turnEvent) {
    Map<String, Object> record = new LinkedHashMap<>();
    record.put("kind", "turn");
    record.put("event", turnEvent.save(new SaveContext()));
    return write(record);
  }

  @Override
  public Boolean appendSession(SessionEvent sessionEvent) {
    Map<String, Object> record = new LinkedHashMap<>();
    record.put("kind", "session");
    record.put("event", sessionEvent.save(new SaveContext()));
    return write(record);
  }

  @Override
  public Boolean close(SessionSummary summary) {
    synchronized (lock) {
      if (closed) {
        return false;
      }
      if (summary != null) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("kind", "summary");
        record.put("summary", summary.save(new SaveContext()));
        if (!append(record)) {
          return false;
        }
      }
      closed = true;
      return true;
    }
  }

  private boolean write(Map<String, Object> record) {
    synchronized (lock) {
      if (closed) {
        return false;
      }
      return append(record);
    }
  }

  private boolean append(Map<String, Object> record) {
    try {
      // Always LF, never the platform separator: Rust's writeln! emits \n, and the journal is
      // compared across runtimes.
      Files.writeString(
          path,
          TypraJson.stringify(record) + "\n",
          StandardCharsets.UTF_8,
          StandardOpenOption.CREATE,
          StandardOpenOption.APPEND);
      return true;
    } catch (IOException e) {
      return false;
    }
  }
}
