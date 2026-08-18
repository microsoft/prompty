package com.microsoft.prompty.engine;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.DelegatedStateReference;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelReconciliationState;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.ResumeContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The input to one canonical turn engine run.
 *
 * <p>This carries not just what to run but where to run from, which is what makes a turn resumable.
 * A fresh turn supplies messages and budgets; a resumed turn additionally supplies the iteration,
 * journal sequence, pending tool queue, and pending model response recovered from a checkpoint, so
 * the engine picks up exactly where the interrupted run stopped rather than repeating committed
 * effects.
 *
 * <p>Hand-written rather than generated: this is a runtime-local entry shape, not a durable
 * cross-runtime contract. The durable shapes it is built from — {@link EngineCheckpoint} and {@link
 * ResumeContext} — are generated.
 */
public final class TurnEngineRequest {

  public String sessionId = "";
  public String turnId = "";

  /** Stable identifier for this run. Empty means the engine assigns one at run start. */
  public String runId = "";

  /** The parent run this run was delegated from, or null for a top-level run. */
  public String parentRunId;

  /** Zero-based delegation nesting depth; 0 for a top-level run. */
  public int delegationDepth;

  public List<Message> messages = new ArrayList<>();
  public Object inputs;
  public int maxIterations = 10;
  public int maxModelAttempts = 3;

  /** The iteration to execute first. Non-zero when resuming a checkpoint. */
  public int startIteration;

  /** The last committed event sequence before this run. */
  public long initialSequence;

  public int stablePrefixMessages;
  public InvocationContextPortability portability = InvocationContextPortability.PORTABLE;
  public List<DelegatedStateReference> delegatedState = new ArrayList<>();
  public String activeInvocationId;
  public List<ModelToolRequest> pendingToolRequests = new ArrayList<>();
  public List<ModelToolResult> completedToolResults = new ArrayList<>();
  public int completedModelIterations;
  public boolean reconciliationRequired;
  public ModelReconciliationState modelReconciliation;
  public Object pendingOutput;
  public boolean finalOutputReady;
  public ModelInvocationResponse pendingModelResponse;
  public boolean policyAppliedForIteration;
  public ModelToolResult reconciliationResolution;
  public ModelInvocationResponse modelReconciliationResolution;

  /**
   * A fresh turn over the supplied conversation.
   *
   * <p>The whole conversation starts as the stable prefix: nothing has been appended yet, so every
   * message is eligible for provider-side prefix caching.
   */
  public static TurnEngineRequest of(String sessionId, String turnId, List<Message> messages) {
    TurnEngineRequest request = new TurnEngineRequest();
    request.sessionId = sessionId;
    request.turnId = turnId;
    request.messages = messages == null ? new ArrayList<>() : new ArrayList<>(messages);
    request.stablePrefixMessages = request.messages.size();
    return request;
  }

  /** Mark this run as delegated from a parent run, nesting one level deeper than the parent. */
  public TurnEngineRequest delegatedUnder(String parentRunId, int parentDelegationDepth) {
    this.parentRunId = parentRunId;
    this.delegationDepth =
        parentDelegationDepth == Integer.MAX_VALUE
            ? Integer.MAX_VALUE
            : parentDelegationDepth + 1;
    return this;
  }

  /** Set the stable run identifier. An empty value lets the engine assign one. */
  public TurnEngineRequest withRunId(String runId) {
    this.runId = runId;
    return this;
  }

  /**
   * Resume from a checkpoint, continuing a journal whose tail may extend past it.
   *
   * <p>Choosing the iteration is the subtle part. A checkpoint that explicitly asks to resume in
   * place does so. A checkpoint with nothing outstanding — no pending tools, no pending model
   * response, no ready output, no reconciliation — finished its iteration, so the run advances.
   * Anything else still has work inside the recorded iteration and resumes there.
   */
  public static TurnEngineRequest resumeFrom(
      EngineCheckpoint checkpoint, int maxIterations, long lastJournalSequence) {
    return resumeFrom(
        checkpoint, maxIterations, lastJournalSequence, isTrue(checkpoint.reconciliationRequired));
  }

  /**
   * The resume body, parameterised on whether reconciliation is still outstanding.
   *
   * <p>The reconciliation entry points resolve the blocking effect first and only then work out
   * where to resume, so they pass {@code false} here: a checkpoint whose sole outstanding item was
   * the effect just resolved has in fact finished its iteration, and resuming in place would rerun
   * it.
   */
  private static TurnEngineRequest resumeFrom(
      EngineCheckpoint checkpoint,
      int maxIterations,
      long lastJournalSequence,
      boolean reconciliationRequired) {
    TurnEngineRequest request = new TurnEngineRequest();
    request.sessionId = checkpoint.sessionId;
    request.turnId = checkpoint.turnId;
    request.runId = checkpoint.runId == null ? "" : checkpoint.runId;
    request.parentRunId = checkpoint.parentRunId;
    request.delegationDepth = orZero(checkpoint.delegationDepth);
    request.messages =
        checkpoint.messages == null ? new ArrayList<>() : new ArrayList<>(checkpoint.messages);
    request.stablePrefixMessages = orZero(checkpoint.stablePrefixMessages);
    request.inputs = checkpoint.inputs;
    request.maxIterations = maxIterations;
    request.maxModelAttempts = 3;

    int iteration = orZero(checkpoint.iteration);
    boolean nothingOutstanding =
        isEmpty(checkpoint.pendingToolRequests)
            && checkpoint.pendingModelResponse == null
            && !isTrue(checkpoint.finalOutputReady)
            && !reconciliationRequired;
    if (isTrue(checkpoint.resumeSameIteration)) {
      request.startIteration = iteration;
    } else if (nothingOutstanding) {
      request.startIteration = iteration + 1;
    } else {
      request.startIteration = iteration;
    }

    long checkpointSequence = checkpoint.lastSequence == null ? 0L : checkpoint.lastSequence;
    request.initialSequence = Math.max(lastJournalSequence, checkpointSequence);
    if (checkpoint.contextState != null) {
      request.portability =
          checkpoint.contextState.portability == null
              ? InvocationContextPortability.PORTABLE
              : checkpoint.contextState.portability;
      request.delegatedState =
          checkpoint.contextState.delegatedState == null
              ? new ArrayList<>()
              : new ArrayList<>(checkpoint.contextState.delegatedState);
    }
    request.activeInvocationId = checkpoint.activeInvocationId;
    request.pendingToolRequests = copyOrEmpty(checkpoint.pendingToolRequests);
    request.completedToolResults = copyOrEmpty(checkpoint.completedToolResults);
    request.completedModelIterations = orZero(checkpoint.completedModelIterations);
    request.reconciliationRequired = reconciliationRequired;
    request.modelReconciliation = checkpoint.modelReconciliation;
    request.pendingOutput = checkpoint.pendingOutput;
    request.finalOutputReady = isTrue(checkpoint.finalOutputReady);
    request.pendingModelResponse = checkpoint.pendingModelResponse;
    request.policyAppliedForIteration = isTrue(checkpoint.policyAppliedForIteration);
    return request;
  }

  /**
   * Resume after the host resolves an indeterminate tool effect.
   *
   * <p>The resolved result replaces the indeterminate one in the checkpoint, and, when the batch was
   * already folded into the conversation, the tool message the model will read is rewritten too —
   * otherwise the model would keep seeing the "outcome unknown" text the engine wrote when it gave
   * up on the effect.
   */
  public static TurnEngineRequest resumeAfterReconciliation(
      EngineCheckpoint checkpoint,
      int maxIterations,
      long lastJournalSequence,
      ModelToolResult resolvedResult) {
    if (!isTrue(checkpoint.reconciliationRequired)) {
      throw new TurnEngineException.InvalidRequest("checkpoint does not require reconciliation");
    }
    if (checkpoint.modelReconciliation != null) {
      throw new TurnEngineException.InvalidRequest(
          "checkpoint requires model reconciliation, not tool reconciliation");
    }
    if (resolvedResult.outcome == ModelToolOutcome.INDETERMINATE) {
      throw new TurnEngineException.InvalidRequest(
          "resolved tool result must have a determinate outcome");
    }

    List<ModelToolResult> results = copyOrEmpty(checkpoint.completedToolResults);
    int index = -1;
    for (int i = 0; i < results.size(); i++) {
      if (Objects.equals(results.get(i).requestId, resolvedResult.requestId)) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      throw new TurnEngineException.InvalidRequest(
          "checkpoint does not contain indeterminate tool request '"
              + resolvedResult.requestId
              + "'");
    }
    if (results.get(index).outcome != ModelToolOutcome.INDETERMINATE) {
      throw new TurnEngineException.InvalidRequest(
          "tool request '" + resolvedResult.requestId + "' is already determinate");
    }
    results.set(index, resolvedResult);

    List<Message> messages = copyOrEmpty(checkpoint.messages);
    if (checkpoint.pendingModelResponse == null) {
      int messageIndex = -1;
      for (int i = 0; i < messages.size(); i++) {
        Map<String, Object> metadata = Messages.metadata(messages.get(i));
        Object toolCallId = metadata == null ? null : metadata.get(Messages.TOOL_CALL_ID);
        if (resolvedResult.requestId.equals(toolCallId)) {
          messageIndex = i;
          break;
        }
      }
      if (messageIndex < 0) {
        throw new TurnEngineException.InvalidRequest(
            "checkpoint is missing the tool result message for '"
                + resolvedResult.requestId
                + "'");
      }
      messages.set(
          messageIndex,
          Messages.toolResult(resolvedResult.requestId, ToolResults.modelText(resolvedResult)));
    }

    TurnEngineRequest request =
        resumeFrom(checkpoint, maxIterations, lastJournalSequence, false);
    request.messages = messages;
    request.completedToolResults = results;
    request.reconciliationResolution = resolvedResult;
    return request;
  }

  /** Resume after the host resolves an indeterminate model invocation. */
  public static TurnEngineRequest resumeAfterModelReconciliation(
      EngineCheckpoint checkpoint,
      int maxIterations,
      long lastJournalSequence,
      ModelInvocationResponse resolvedResponse) {
    if (!isTrue(checkpoint.reconciliationRequired)) {
      throw new TurnEngineException.InvalidRequest("checkpoint does not require reconciliation");
    }
    ModelReconciliationState reconciliation = checkpoint.modelReconciliation;
    if (reconciliation == null) {
      throw new TurnEngineException.InvalidRequest(
          "checkpoint requires tool reconciliation, not model reconciliation");
    }
    if (!Objects.equals(checkpoint.activeInvocationId, reconciliation.invocationId)) {
      throw new TurnEngineException.InvalidRequest(
          "model reconciliation identity does not match the active invocation");
    }

    TurnEngineRequest request = resumeFrom(checkpoint, maxIterations, lastJournalSequence);
    request.startIteration = orZero(checkpoint.iteration);
    request.reconciliationRequired = false;
    request.modelReconciliationResolution = resolvedResponse;
    return request;
  }

  /**
   * Resume from the durable {@link ResumeContext} record.
   *
   * <p>Unlike {@link #resumeFrom}, this threads the attempt budget from the persisted record rather
   * than defaulting it, so a resumed run keeps the retry policy the original run was given.
   */
  public static TurnEngineRequest fromResume(ResumeContext resume) {
    TurnEngineRequest request =
        resumeFrom(resume.checkpoint, maxIterationsOf(resume), resumeSequence(resume));
    applyResumeAttempts(request, resume);
    return request;
  }

  /** Resume from a {@link ResumeContext} after the host resolves an indeterminate tool effect. */
  public static TurnEngineRequest fromResumeAfterReconciliation(
      ResumeContext resume, ModelToolResult resolvedResult) {
    TurnEngineRequest request =
        resumeAfterReconciliation(
            resume.checkpoint, maxIterationsOf(resume), resumeSequence(resume), resolvedResult);
    applyResumeAttempts(request, resume);
    return request;
  }

  /** Resume from a {@link ResumeContext} after the host resolves an indeterminate invocation. */
  public static TurnEngineRequest fromResumeAfterModelReconciliation(
      ResumeContext resume, ModelInvocationResponse resolvedResponse) {
    TurnEngineRequest request =
        resumeAfterModelReconciliation(
            resume.checkpoint, maxIterationsOf(resume), resumeSequence(resume), resolvedResponse);
    applyResumeAttempts(request, resume);
    return request;
  }

  private static void applyResumeAttempts(TurnEngineRequest request, ResumeContext resume) {
    if (resume.maxModelAttempts != null && resume.maxModelAttempts > 0) {
      request.maxModelAttempts = resume.maxModelAttempts;
    }
  }

  private static int maxIterationsOf(ResumeContext resume) {
    return Math.max(resume.maxIterations == null ? 0 : resume.maxIterations, 0);
  }

  /**
   * The journal position a resumed run continues from: the further of the checkpoint's own sequence
   * and any journal tail written after it.
   */
  private static long resumeSequence(ResumeContext resume) {
    long journal = resume.lastJournalSequence == null ? 0L : resume.lastJournalSequence;
    long checkpoint =
        resume.checkpoint == null || resume.checkpoint.lastSequence == null
            ? 0L
            : resume.checkpoint.lastSequence;
    return Math.max(Math.max(journal, checkpoint), 0L);
  }

  private static boolean isTrue(Boolean value) {
    return value != null && value;
  }

  private static int orZero(Integer value) {
    return value == null ? 0 : value;
  }

  private static boolean isEmpty(List<?> list) {
    return list == null || list.isEmpty();
  }

  private static <T> List<T> copyOrEmpty(List<T> list) {
    return list == null ? new ArrayList<>() : new ArrayList<>(list);
  }
}
