package com.microsoft.prompty.engine;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.FinalOutputPolicyRequest;
import com.microsoft.prompty.model.FinalOutputPolicyResult;
import com.microsoft.prompty.model.HostPolicyRequest;
import com.microsoft.prompty.model.HostPolicyResult;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.RetryPolicyRequest;
import com.microsoft.prompty.model.TurnCommit;
import java.util.List;

/**
 * The effect ports the turn engine drives.
 *
 * <p>The engine itself performs no I/O. Every outward effect — invoking a model, running a tool,
 * asking permission, writing the journal — goes through one of these interfaces, which is what lets
 * the same loop run a live provider turn and a deterministic replay without behaving differently.
 *
 * <p>All ports are synchronous, matching the rest of this runtime: callers that need concurrency run
 * a turn on its own (virtual) thread rather than threading futures through the state machine.
 */
public final class Ports {

  private Ports() {}

  /** Invokes a model for one prepared context snapshot. */
  public interface ModelPort {
    ModelInvocationResponse invoke(
        ModelInvocationRequest request, CancellationToken cancellation, ModelStreamPort stream);
  }

  /** Receives ephemeral chunks while a model invocation is in flight. */
  public interface ModelStreamPort {
    /** Deliver a chunk. A delivery failure must never change semantic execution. */
    void emit(ModelStreamChunk chunk);
  }

  /**
   * Lets the host inspect and rewrite canonical state at the two points where doing so is safe.
   *
   * <p>This is the seam guardrails, context trimming, and steering plug into.
   */
  public interface HostPolicyPort {
    HostPolicyResult beforeModel(HostPolicyRequest request, CancellationToken cancellation);

    FinalOutputPolicyResult beforeCommit(
        FinalOutputPolicyRequest request, CancellationToken cancellation);
  }

  /** Waits between failed model attempts. */
  public interface RetryPolicyPort {
    void backoff(RetryPolicyRequest request, CancellationToken cancellation);
  }

  /**
   * Turns one completed model/tool batch into provider-valid conversation messages.
   *
   * <p>Providers disagree about this: OpenAI wants one message per tool result, Anthropic wants a
   * single user message carrying every result. Delegating it keeps that difference out of the
   * engine.
   */
  public interface ConversationPort {
    List<Message> formatToolExchange(ModelInvocationResponse response, List<ModelToolResult> results);
  }

  /** Decides whether a tool request may run. */
  public interface PermissionPort {
    EnginePermissionDecision authorize(ModelToolRequest request, CancellationToken cancellation);
  }

  /** Runs an authorized tool request. */
  public interface ToolPort {
    ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation);
  }

  /**
   * Persists the engine's event journal and checkpoints.
   *
   * <p>{@link #appendWithCheckpoint} must be atomic. The engine relies on an event and the
   * checkpoint that includes it landing together; if they can diverge, a resumed run can replay an
   * effect that was already committed.
   */
  public interface DurabilityPort {
    void append(EngineEvent event);

    void appendWithCheckpoint(List<EngineEvent> events, EngineCheckpoint checkpoint);
  }

  /** Runs a non-fatal effect after a successful turn is committed. */
  public interface PostCommitPort {
    void afterCommit(String effectId, TurnCommit commit, CancellationToken cancellation);
  }

  /** Supplies timestamps. Replay substitutes a deterministic implementation. */
  public interface Clock {
    String now();
  }

  /** Supplies identifiers. Replay substitutes a deterministic implementation. */
  public interface IdGenerator {
    String nextId(String kind);
  }
}
