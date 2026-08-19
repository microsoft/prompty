package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.Checkpoint;
import com.microsoft.prompty.model.CheckpointStore;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Stores checkpoints in memory, keyed by session and checkpoint identifier.
 *
 * <p>Listing is sorted by checkpoint id rather than by insertion, so a caller resuming a session
 * sees the same order whichever store implementation the host swapped in.
 */
public final class InMemoryCheckpointStore implements CheckpointStore {

  private record Key(String sessionId, String checkpointId) {}

  private final Map<Key, Checkpoint> checkpoints = new LinkedHashMap<>();

  @Override
  public synchronized Checkpoint save(Checkpoint checkpoint) {
    if (checkpoint.sessionId == null) {
      throw new IllegalArgumentException("Checkpoint session_id is required");
    }
    if (checkpoint.id == null) {
      throw new IllegalArgumentException("Checkpoint id is required");
    }
    checkpoints.put(new Key(checkpoint.sessionId, checkpoint.id), checkpoint);
    return checkpoint;
  }

  @Override
  public synchronized Checkpoint load(String sessionId, String checkpointId) {
    return checkpoints.get(new Key(sessionId, checkpointId));
  }

  @Override
  public synchronized List<Checkpoint> listCheckpoints(String sessionId) {
    List<Checkpoint> found = new ArrayList<>();
    for (Map.Entry<Key, Checkpoint> entry : checkpoints.entrySet()) {
      if (entry.getKey().sessionId().equals(sessionId)) {
        found.add(entry.getValue());
      }
    }
    found.sort(Comparator.comparing(checkpoint -> checkpoint.id, Comparator.nullsFirst(Comparator.naturalOrder())));
    return found;
  }
}
