package com.microsoft.prompty.engine;

import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.ModelToolResult;
import java.util.List;

/**
 * A failure that prevents the engine from producing a committed turn.
 *
 * <p>Most problems do <em>not</em> surface as one of these. A model that keeps failing, a tool that
 * throws, a policy that rejects the input — those all produce a committed turn with a {@code failed}
 * status, because the host still needs the journal and the conversation. These exceptions are for
 * the cases where committing is itself impossible.
 */
public abstract class TurnEngineException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  protected TurnEngineException(String message, Throwable cause) {
    super(message, cause);
  }

  /** The request cannot start a turn at all. */
  public static final class InvalidRequest extends TurnEngineException {
    private static final long serialVersionUID = 1L;

    public InvalidRequest(String message) {
      super("invalid turn request: " + message, null);
    }
  }

  /** A port failed at a point where the engine cannot record a decision. */
  public static final class Port extends TurnEngineException {
    private static final long serialVersionUID = 1L;

    private final String stage;

    public Port(String stage, PortException cause) {
      super(stage + " failed: " + cause.getMessage(), cause);
      this.stage = stage;
    }

    public String stage() {
      return stage;
    }
  }

  /**
   * An effect succeeded but the durable record of it did not.
   *
   * <p>This is the dangerous case, so it carries everything a host needs to recover: the checkpoint
   * that failed to persist and the tool results accumulated so far. Without them the effect is
   * invisible to a resumed run, which would then execute it a second time.
   */
  public static final class RecoveryRequired extends TurnEngineException {
    private static final long serialVersionUID = 1L;

    private final String stage;
    private final String requestId;
    private final transient EngineCheckpoint checkpoint;
    private final transient List<ModelToolResult> toolResults;

    public RecoveryRequired(
        String stage,
        String requestId,
        EngineCheckpoint checkpoint,
        List<ModelToolResult> toolResults,
        PortException cause) {
      super(
          stage + " durability failed after effect '" + requestId + "': " + cause.getMessage(),
          cause);
      this.stage = stage;
      this.requestId = requestId;
      this.checkpoint = checkpoint;
      this.toolResults = toolResults;
    }

    public String stage() {
      return stage;
    }

    /** The effect whose durable record is missing. */
    public String requestId() {
      return requestId;
    }

    /** The checkpoint that could not be persisted; the host must store it to resume safely. */
    public EngineCheckpoint checkpoint() {
      return checkpoint;
    }

    /** Tool results accumulated up to the failure. */
    public List<ModelToolResult> toolResults() {
      return toolResults;
    }
  }
}
