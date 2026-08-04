package com.microsoft.prompty.engine;

import com.microsoft.prompty.model.ContextRequest;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import java.util.List;
import java.util.Objects;

/**
 * Snapshot invariants required for caching, portability, and replay.
 *
 * <p>These validators live here rather than on {@code ModelInvocationContextSnapshot} because that
 * class is emitted from the shared schema and must not be hand-edited.
 */
public final class Snapshots {

  private Snapshots() {}

  /**
   * Check the invariants a snapshot must hold regardless of which request produced it.
   *
   * <p>The stable prefix must actually exist in the snapshot, because it is what a provider caches
   * against. Portability and delegated state must agree: a snapshot claiming to be portable while
   * pointing at provider-held state cannot be replayed elsewhere, and one claiming delegation while
   * naming no state cannot be resumed at all.
   */
  public static void validate(ModelInvocationContextSnapshot snapshot) {
    int prefix = snapshot.stablePrefixMessages == null ? 0 : snapshot.stablePrefixMessages;
    int size = snapshot.messages == null ? 0 : snapshot.messages.size();
    if (prefix < 0 || prefix > size) {
      throw ContextException.invalidSnapshot(
          "stable prefix contains " + prefix + " messages but snapshot contains " + size);
    }
    InvocationContextState state = snapshot.contextState;
    InvocationContextPortability portability =
        state == null || state.portability == null
            ? InvocationContextPortability.PORTABLE
            : state.portability;
    List<?> delegated = state == null ? null : state.delegatedState;
    boolean hasDelegated = delegated != null && !delegated.isEmpty();
    if (portability == InvocationContextPortability.PORTABLE && hasDelegated) {
      throw ContextException.invalidSnapshot(
          "portable snapshots cannot contain delegated provider state");
    }
    if (portability == InvocationContextPortability.DELEGATED && !hasDelegated) {
      throw ContextException.invalidSnapshot(
          "delegated snapshots must identify provider-held state");
    }
  }

  /** Check snapshot invariants and that the snapshot identifies the invocation it was built for. */
  public static void validateFor(ModelInvocationContextSnapshot snapshot, ContextRequest request) {
    validate(snapshot);
    if (!Objects.equals(snapshot.sessionId, request.sessionId)
        || !Objects.equals(snapshot.turnId, request.turnId)
        || !Objects.equals(snapshot.invocationId, request.invocationId)
        || !Objects.equals(snapshot.iteration, request.iteration)) {
      throw ContextException.invalidSnapshot(
          "snapshot identity ("
              + snapshot.sessionId
              + "/"
              + snapshot.turnId
              + "/"
              + snapshot.invocationId
              + "/"
              + snapshot.iteration
              + ") does not match request ("
              + request.sessionId
              + "/"
              + request.turnId
              + "/"
              + request.invocationId
              + "/"
              + request.iteration
              + ")");
    }
  }
}
