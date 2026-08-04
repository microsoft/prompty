package com.microsoft.prompty.engine;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.FinalOutputPolicyRequest;
import com.microsoft.prompty.model.FinalOutputPolicyResult;
import com.microsoft.prompty.model.HostPolicyRequest;
import com.microsoft.prompty.model.HostPolicyResult;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.RetryPolicyRequest;
import com.microsoft.prompty.model.TurnCommit;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Neutral port implementations used when a host supplies nothing of its own.
 *
 * <p>Each is a genuine no-op rather than a stub that throws, so an engine wired entirely from these
 * defaults runs a complete, correct turn — it simply keeps no journal, asks no permission, and
 * leaves canonical state untouched.
 */
public final class DefaultPorts {

  private DefaultPorts() {}

  /** Approves every tool request. */
  public static final class AllowAllPermissions implements Ports.PermissionPort {
    @Override
    public EnginePermissionDecision authorize(
        ModelToolRequest request, CancellationToken cancellation) {
      EnginePermissionDecision decision = new EnginePermissionDecision();
      decision.approved = true;
      decision.reason = "allow_all";
      return decision;
    }
  }

  /** Discards every event and checkpoint. */
  public static final class NoopDurability implements Ports.DurabilityPort {
    @Override
    public void append(EngineEvent event) {
      // Intentionally empty: a host that wants durability supplies its own port.
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> events, EngineCheckpoint checkpoint) {
      // Intentionally empty.
    }
  }

  /** Runs no post-commit effect. */
  public static final class NoopPostCommit implements Ports.PostCommitPort {
    @Override
    public void afterCommit(String effectId, TurnCommit commit, CancellationToken cancellation) {
      // Intentionally empty.
    }
  }

  /** Discards every stream chunk. */
  public static final class NoopModelStream implements Ports.ModelStreamPort {
    @Override
    public void emit(ModelStreamChunk chunk) {
      // Intentionally empty.
    }
  }

  /** Returns canonical state and final output unchanged. */
  public static final class NoopHostPolicy implements Ports.HostPolicyPort {
    @Override
    public HostPolicyResult beforeModel(HostPolicyRequest request, CancellationToken cancellation) {
      HostPolicyResult result = new HostPolicyResult();
      result.messages = request.messages;
      result.stablePrefixMessages = request.stablePrefixMessages;
      return result;
    }

    @Override
    public FinalOutputPolicyResult beforeCommit(
        FinalOutputPolicyRequest request, CancellationToken cancellation) {
      FinalOutputPolicyResult result = new FinalOutputPolicyResult();
      result.output = request.output;
      return result;
    }
  }

  /** Retries immediately, with no delay. */
  public static final class NoopRetryPolicy implements Ports.RetryPolicyPort {
    @Override
    public void backoff(RetryPolicyRequest request, CancellationToken cancellation) {
      // Intentionally empty: deterministic tests must not wait, and a host that wants
      // exponential backoff supplies its own port.
    }
  }

  /**
   * Provider-neutral tool formatting: keep the assistant messages, then append one tool message per
   * request, in request order.
   *
   * <p>Ordering follows {@code response.toolRequests} rather than the order results arrived, so the
   * conversation a resumed run rebuilds matches the one the original run sent.
   */
  public static final class DefaultConversation implements Ports.ConversationPort {
    @Override
    public List<Message> formatToolExchange(
        ModelInvocationResponse response, List<ModelToolResult> results) {
      List<Message> messages = new ArrayList<>();
      if (response.assistantMessages != null) {
        messages.addAll(response.assistantMessages);
      }
      if (response.toolRequests != null) {
        for (ModelToolRequest request : response.toolRequests) {
          for (ModelToolResult result : results) {
            if (request.id.equals(result.requestId)) {
              messages.add(Messages.toolResult(request.id, ToolResults.modelText(result)));
              break;
            }
          }
        }
      }
      return messages;
    }
  }

  /** Wall-clock timestamps in ISO-8601. */
  public static final class SystemClock implements Ports.Clock {
    @Override
    public String now() {
      return Instant.now().toString();
    }
  }

  /**
   * Monotonically numbered identifiers of the form {@code kind-1}, {@code kind-2}, ….
   *
   * <p>Unique within one generator instance, which is all the engine needs: identifiers scope a
   * single run, and a host wanting globally unique values supplies its own generator.
   */
  public static final class SequentialIds implements Ports.IdGenerator {
    private final AtomicLong counter = new AtomicLong();

    @Override
    public String nextId(String kind) {
      return kind + "-" + counter.incrementAndGet();
    }
  }
}
