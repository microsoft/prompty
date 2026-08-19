package com.microsoft.prompty.engine;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.ContextRequest;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.EngineTurnStatus;
import com.microsoft.prompty.model.FinalOutputPolicyRequest;
import com.microsoft.prompty.model.FinalOutputPolicyResult;
import com.microsoft.prompty.model.HostPolicyRequest;
import com.microsoft.prompty.model.HostPolicyResult;
import com.microsoft.prompty.model.DelegatedStateReference;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelReconciliationState;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.ResumeContext;
import com.microsoft.prompty.model.RetryPolicyRequest;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.TurnCommit;
import com.microsoft.prompty.model.TurnEngineResult;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The canonical turn state machine.
 *
 * <p>One loop drives every kind of turn — live provider calls, deterministic replay, resumed
 * checkpoints — because the engine itself performs no I/O. Every outward effect goes through a port,
 * so swapping a live model for a canned one changes what happens without changing what the engine
 * decides.
 *
 * <p>The loop advances through three mutually exclusive states per iteration:
 *
 * <ol>
 *   <li>a completed tool batch waiting to be folded into the conversation,
 *   <li>tool requests still waiting to run, or
 *   <li>neither, meaning it is time to call the model again.
 * </ol>
 *
 * <p>Splitting a tool round this way — one request per pass, each persisted before the next starts —
 * is what makes an interrupted turn resumable at tool granularity rather than restarting the whole
 * round.
 */
public final class TurnEngine {

  private final ContextPipeline context;
  private final TurnEngineEffects effects;

  public TurnEngine(ContextPipeline context, TurnEngineEffects effects) {
    this.context = context;
    this.effects = effects;
  }

  /** An engine over the append-only context pipeline. */
  public static TurnEngine of(TurnEngineEffects effects) {
    return new TurnEngine(ContextPipeline.appendOnly(), effects);
  }

  /** Resume an interrupted turn from a durable {@link ResumeContext}. */
  public TurnEngineResult resume(ResumeContext resume, CancellationToken cancellation) {
    return run(TurnEngineRequest.fromResume(resume), cancellation);
  }

  /** Run one turn to a committed result. */
  public TurnEngineResult run(TurnEngineRequest request, CancellationToken cancellation) {
    validateRequest(request);
    TurnState state = new TurnState(request);
    // Rust consumes the request by value, so an engine-assigned run id is never visible to the
    // caller. Java passes by reference, so the id is assigned onto the run state instead of
    // written back — otherwise reusing one request for a second run would silently inherit the
    // first run's identity.
    if (state.runId == null || state.runId.isEmpty()) {
      state.runId = effects.ids.nextId("run");
    }

    Map<String, Object> startPayload = new LinkedHashMap<>();
    startPayload.put("maxIterations", state.maxIterations);
    startPayload.put("startIteration", state.iteration);
    startPayload.put("inputs", state.inputs);
    emit(state, EngineEventKind.TURN_STARTED, null, null, startPayload);

    if (state.modelReconciliationResolution != null) {
      ModelInvocationResponse response = state.modelReconciliationResolution;
      state.modelReconciliationResolution = null;
      ModelReconciliationState reconciliation = state.modelReconciliation;
      if (reconciliation == null) {
        throw new TurnEngineException.InvalidRequest(
            "model reconciliation response is missing durable reconciliation state");
      }
      state.reconciliationRequired = false;
      state.modelReconciliation = null;
      String error = state.applyModelResponse(reconciliation.invocationId, response);
      if (error != null) {
        return commitFailed(state, "provider_state_error", error, cancellation);
      }
      persistModelReconciliation(state, reconciliation.invocationId, reconciliation, response);
    }

    if (state.reconciliationResolution != null) {
      ModelToolResult resolution = state.reconciliationResolution;
      state.reconciliationResolution = null;
      persistReconciliation(state, resolution);
    }

    if (state.reconciliationRequired) {
      return commitReconciliation(
          state,
          "effect_outcome_unknown",
          "Checkpoint requires explicit effect reconciliation",
          cancellation);
    }

    if (state.finalOutputReady) {
      if (cancellation.isCancelled()) {
        return commitCancelled(state, cancellation);
      }
      state.output = state.pendingOutput;
      return applyFinalPolicy(state, cancellation);
    }

    while (state.iteration < state.maxIterations) {
      if (cancellation.isCancelled()) {
        return commitCancelled(state, cancellation);
      }

      // (1) A tool batch is complete: fold it into the conversation and close the iteration.
      if (state.pendingToolRequests.isEmpty() && state.pendingModelResponse != null) {
        String invocationId =
            state.activeInvocationId != null
                ? state.activeInvocationId
                : effects.ids.nextId("invocation");
        List<ModelToolResult> results;
        try {
          results = finalizeToolExchange(state);
        } catch (PortException e) {
          return commitFailed(state, "conversation_format_error", e.getMessage(), cancellation);
        }
        persistToolExchange(state, invocationId, results);
        state.activeInvocationId = null;
        state.iteration++;
        continue;
      }

      // (2) Tools are still outstanding: run exactly one, then persist before touching the next.
      if (!state.pendingToolRequests.isEmpty()) {
        String invocationId =
            state.activeInvocationId != null
                ? state.activeInvocationId
                : effects.ids.nextId("invocation");
        ModelToolRequest toolRequest = state.pendingToolRequests.remove(0);
        ModelToolResult toolResult;
        try {
          toolResult = executeTool(state, invocationId, toolRequest, cancellation);
        } catch (ToolCancelled e) {
          return commitCancelled(state, cancellation);
        } catch (ToolPermissionFailed e) {
          return commitFailed(state, "permission_error", e.getMessage(), cancellation);
        } catch (ToolConfigurationFailed e) {
          return commitFailed(state, "tool_configuration_error", e.getMessage(), cancellation);
        }
        boolean outcomeUnknown = toolResult.outcome == ModelToolOutcome.INDETERMINATE;
        state.toolResults.add(toolResult);
        if (state.pendingModelResponse == null) {
          // Recovery path for checkpoints written before the conversation batch became
          // explicit state: without a held response there is nothing to fold later, so the
          // result has to enter the conversation now.
          state.messages.add(
              Messages.toolResult(toolRequest.id, ToolResults.modelText(toolResult)));
        }
        persistToolResult(state, invocationId, toolRequest);
        if (outcomeUnknown) {
          return commitReconciliation(
              state,
              "effect_outcome_unknown",
              "Tool effect outcome is unknown and requires reconciliation",
              cancellation);
        }
        if (state.pendingToolRequests.isEmpty() && state.pendingModelResponse == null) {
          state.activeInvocationId = null;
          state.iteration++;
        }
        continue;
      }

      // (3) Nothing outstanding: prepare context and invoke the model.
      String invocationId = effects.ids.nextId("invocation");
      if (state.policyAppliedForIteration) {
        // The policy already ran for this iteration and its rewrite was checkpointed, so
        // rerunning it on resume would apply the same transformation twice.
        state.policyAppliedForIteration = false;
      } else {
        HostPolicyRequest policyRequest = new HostPolicyRequest();
        policyRequest.sessionId = state.sessionId;
        policyRequest.turnId = state.turnId;
        policyRequest.iteration = state.iteration;
        policyRequest.messages = new ArrayList<>(state.messages);
        policyRequest.stablePrefixMessages = state.stablePrefixMessages;
        policyRequest.inputs = state.inputs;

        HostPolicyResult policyResult;
        try {
          policyResult = effects.policy.beforeModel(policyRequest, cancellation);
        } catch (HostPolicyException e) {
          return commitFailed(state, e.errorKind(), e.getMessage(), cancellation);
        }
        if (cancellation.isCancelled()) {
          return commitCancelled(state, cancellation);
        }
        List<Message> rewritten =
            policyResult.messages == null ? new ArrayList<>() : policyResult.messages;
        int rewrittenPrefix =
            policyResult.stablePrefixMessages == null ? 0 : policyResult.stablePrefixMessages;
        if (rewrittenPrefix < 0 || rewrittenPrefix > rewritten.size()) {
          return commitFailed(
              state,
              "policy_error",
              "host policy stable prefix exceeds rewritten message count",
              cancellation);
        }
        boolean policyChanged =
            !state.messages.equals(rewritten) || state.stablePrefixMessages != rewrittenPrefix;
        if (policyChanged) {
          state.messages = new ArrayList<>(rewritten);
          state.stablePrefixMessages = rewrittenPrefix;
          persistPolicyUpdate(state, invocationId, policyResult.metadata);
          state.policyAppliedForIteration = false;
        }
      }

      ContextRequest contextRequest = new ContextRequest();
      contextRequest.sessionId = state.sessionId;
      contextRequest.turnId = state.turnId;
      contextRequest.invocationId = invocationId;
      contextRequest.iteration = state.iteration;
      contextRequest.messages = new ArrayList<>(state.messages);
      contextRequest.stablePrefixMessages =
          Math.min(state.stablePrefixMessages, state.messages.size());
      contextRequest.contextState = currentContextState(state);
      contextRequest.inputs = state.inputs;

      ModelInvocationContextSnapshot snapshot;
      try {
        snapshot = context.prepare(contextRequest);
      } catch (ContextException e) {
        return commitFailed(state, "context_error", e.getMessage(), cancellation);
      }
      int iteration = state.iteration;
      emit(state, EngineEventKind.CONTEXT_PREPARED, invocationId, iteration, save(snapshot));
      state.snapshots.add(snapshot);

      if (cancellation.isCancelled()) {
        return commitCancelled(state, cancellation);
      }

      ModelInvocationRequest modelRequest = new ModelInvocationRequest();
      modelRequest.context = snapshot;
      state.activeInvocationId = invocationId;

      int attempt = 0;
      ModelInvocationResponse modelResponse = null;
      while (modelResponse == null) {
        if (cancellation.isCancelled()) {
          return commitCancelled(state, cancellation);
        }
        Map<String, Object> startedPayload = new LinkedHashMap<>();
        startedPayload.put("snapshotId", snapshot.id);
        startedPayload.put("attempt", attempt);
        startedPayload.put("messageCount", snapshot.messages == null ? 0 : snapshot.messages.size());
        emit(
            state,
            EngineEventKind.MODEL_INVOCATION_STARTED,
            invocationId,
            iteration,
            startedPayload);

        try {
          modelResponse = effects.model.invoke(modelRequest, cancellation, effects.stream);
        } catch (PortException source) {
          if (cancellation.isCancelled()) {
            return commitCancelled(state, cancellation);
          }
          attempt++;
          boolean outcomeUnknown = source.outcomeUnknown();
          boolean exhausted = outcomeUnknown || attempt >= state.maxModelAttempts;
          String reason = source.getMessage();

          Map<String, Object> failedPayload = new LinkedHashMap<>();
          failedPayload.put("attempt", attempt - 1);
          failedPayload.put("exhausted", exhausted);
          failedPayload.put("outcomeUnknown", outcomeUnknown);
          failedPayload.put("message", reason);
          emit(
              state,
              EngineEventKind.MODEL_INVOCATION_FAILED,
              invocationId,
              iteration,
              failedPayload);

          if (outcomeUnknown) {
            // The provider may have run the invocation. Retrying could duplicate it and
            // committing could lose it, so the turn stops for the host to reconcile.
            state.reconciliationRequired = true;
            ModelReconciliationState reconciliation = new ModelReconciliationState();
            reconciliation.invocationId = invocationId;
            reconciliation.request = modelRequest;
            reconciliation.failedAttempt = attempt - 1;
            reconciliation.message = reason;
            reconciliation.metadata = source.metadata();
            state.modelReconciliation = reconciliation;
            persistModelReconciliationRequired(state, invocationId);
            return commitReconciliation(state, "model_outcome_unknown", reason, cancellation);
          }
          if (exhausted) {
            return commitFailed(state, "model_error", reason, cancellation);
          }

          RetryPolicyRequest retryRequest = new RetryPolicyRequest();
          retryRequest.failedAttempts = attempt;
          retryRequest.nextAttempt = attempt + 1;
          retryRequest.maxAttempts = state.maxModelAttempts;
          retryRequest.reason = reason;
          try {
            effects.retry.backoff(retryRequest, cancellation);
          } catch (RetryPolicyException e) {
            if (e.isCancelled()) {
              return commitCancelled(state, cancellation);
            }
            return commitFailed(state, "retry_policy_error", e.getMessage(), cancellation);
          }
          if (cancellation.isCancelled()) {
            return commitCancelled(state, cancellation);
          }
        }
      }

      state.modelReconciliation = null;
      state.reconciliationRequired = false;
      String error = state.applyModelResponse(invocationId, modelResponse);
      if (error != null) {
        return commitFailed(state, "provider_state_error", error, cancellation);
      }
      persistModelResponse(state, invocationId, modelResponse);

      if (cancellation.isCancelled()) {
        return commitCancelled(state, cancellation);
      }

      if (state.finalOutputReady) {
        state.output = state.pendingOutput;
        return applyFinalPolicy(state, cancellation);
      }
    }

    return commitFailed(state, "max_iterations", "Maximum model iterations reached", cancellation);
  }

  private void validateRequest(TurnEngineRequest request) {
    if (request.sessionId == null || request.sessionId.isEmpty()) {
      throw new TurnEngineException.InvalidRequest("session_id is required");
    }
    if (request.turnId == null || request.turnId.isEmpty()) {
      throw new TurnEngineException.InvalidRequest("turn_id is required");
    }
    if (request.maxModelAttempts <= 0) {
      throw new TurnEngineException.InvalidRequest("max_model_attempts must be greater than zero");
    }
    if (request.startIteration > request.maxIterations) {
      throw new TurnEngineException.InvalidRequest("start_iteration must not exceed max_iterations");
    }
    int messageCount = request.messages == null ? 0 : request.messages.size();
    if (request.stablePrefixMessages > messageCount) {
      throw new TurnEngineException.InvalidRequest(
          "stable_prefix_messages exceeds initial message count");
    }
    if (request.portability == InvocationContextPortability.PORTABLE
        && request.delegatedState != null
        && !request.delegatedState.isEmpty()) {
      throw new TurnEngineException.InvalidRequest(
          "portable turns cannot begin with delegated provider state");
    }
  }

  /**
   * Fold a completed tool batch into the conversation.
   *
   * <p>Formatting only happens once every request in the batch has a result. A partially answered
   * batch is put back untouched, because emitting half of one would leave the conversation with
   * unmatched tool calls that most providers reject outright.
   */
  private List<ModelToolResult> finalizeToolExchange(TurnState state) {
    ModelInvocationResponse response = state.pendingModelResponse;
    if (response == null) {
      return new ArrayList<>();
    }
    state.pendingModelResponse = null;
    List<ModelToolRequest> requests =
        response.toolRequests == null ? new ArrayList<>() : response.toolRequests;
    if (requests.isEmpty()) {
      return new ArrayList<>();
    }
    List<ModelToolResult> results = new ArrayList<>();
    for (ModelToolRequest request : requests) {
      for (ModelToolResult result : state.toolResults) {
        if (Objects.equals(request.id, result.requestId)) {
          results.add(result);
          break;
        }
      }
    }
    if (results.size() != requests.size()) {
      state.pendingModelResponse = response;
      throw PortException.configuration("tool exchange is incomplete and cannot be formatted");
    }
    List<Message> messages;
    try {
      messages = effects.conversation.formatToolExchange(response, results);
    } catch (PortException e) {
      state.pendingModelResponse = response;
      throw e;
    }
    if (messages != null) {
      state.messages.addAll(messages);
    }
    return results;
  }

  /**
   * Run one tool request end to end: ask, record the answer, execute, and classify the outcome.
   *
   * <p>A denial is not an engine failure — it is returned as a failed tool result so the model sees
   * it and can adapt, which is what lets a host decline an action without aborting the turn.
   */
  private ModelToolResult executeTool(
      TurnState state,
      String invocationId,
      ModelToolRequest request,
      CancellationToken cancellation) {
    Map<String, Object> requestPayload = new LinkedHashMap<>();
    requestPayload.put("toolRequest", save(request));
    emit(
        state,
        EngineEventKind.PERMISSION_REQUESTED,
        invocationId,
        state.iteration,
        requestPayload);

    EnginePermissionDecision decision;
    try {
      decision = effects.permission.authorize(request, cancellation);
    } catch (PortException e) {
      throw new ToolPermissionFailed(e);
    }

    Map<String, Object> resolvedPayload = new LinkedHashMap<>();
    resolvedPayload.put("toolRequestId", request.id);
    resolvedPayload.put("decision", save(decision));
    emit(
        state, EngineEventKind.PERMISSION_RESOLVED, invocationId, state.iteration, resolvedPayload);

    if (decision.approved == null || !decision.approved) {
      Object declaredKind = decision.metadata == null ? null : decision.metadata.get("errorKind");
      String errorKind =
          declaredKind instanceof String text && !text.isEmpty() ? text : "permission_denied";
      ModelToolResult denied = new ModelToolResult();
      denied.requestId = request.id;
      denied.name = request.name;
      denied.outcome = ModelToolOutcome.FAILED;
      denied.output = decision.reason == null ? "Permission denied" : decision.reason;
      denied.errorKind = errorKind;
      denied.metadata = decision.metadata;
      return denied;
    }

    if (cancellation.isCancelled()) {
      throw new ToolCancelled();
    }

    Map<String, Object> startedPayload = new LinkedHashMap<>();
    startedPayload.put("toolRequest", save(request));
    emit(
        state,
        EngineEventKind.TOOL_EXECUTION_STARTED,
        invocationId,
        state.iteration,
        startedPayload);
    if (cancellation.isCancelled()) {
      throw new ToolCancelled();
    }

    try {
      return effects.tools.execute(request, cancellation);
    } catch (PortException error) {
      if (error.configurationError()) {
        throw new ToolConfigurationFailed(error);
      }
      // A tool that simply failed is model-visible data, not an engine fault: the model is
      // given the failure and gets to decide what to do about it.
      ModelToolResult result = new ModelToolResult();
      result.requestId = request.id;
      result.name = request.name;
      result.outcome =
          error.outcomeUnknown() ? ModelToolOutcome.INDETERMINATE : ModelToolOutcome.FAILED;
      result.output =
          error.outcomeUnknown()
              ? "Tool '"
                  + request.name
                  + "' outcome is unknown and requires reconciliation: "
                  + error.getMessage()
              : "Tool '" + request.name + "' failed: " + error.getMessage();
      result.errorKind = error.outcomeUnknown() ? "effect_outcome_unknown" : "tool_error";
      return result;
    }
  }

  private EngineCheckpoint persistPolicyUpdate(
      TurnState state, String invocationId, Map<String, Object> metadata) {
    long sequence = state.sequence + 1;
    // Set before building the checkpoint so a resumed run knows the rewrite already happened.
    state.policyAppliedForIteration = true;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, true);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("messages", saveMessages(state.messages));
    payload.put("stablePrefixMessages", state.stablePrefixMessages);
    payload.put("metadata", metadata);
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.POLICY_APPLIED,
            invocationId,
            state.iteration,
            payload);
    appendWithCheckpoint(
        state, "host policy", invocationId, checkpoint, List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistToolExchange(
      TurnState state, String invocationId, List<ModelToolResult> results) {
    long sequence = state.sequence;
    List<EngineEvent> events = new ArrayList<>();
    for (ModelToolResult result : results) {
      sequence++;
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("toolResult", save(result));
      events.add(
          buildEvent(
              state,
              sequence,
              EngineEventKind.TOOL_RESULT_COMMITTED,
              invocationId,
              state.iteration,
              payload));
    }
    sequence++;
    Map<String, Object> conversationPayload = new LinkedHashMap<>();
    conversationPayload.put("messageCount", state.messages.size());
    events.add(
        buildEvent(
            state,
            sequence,
            EngineEventKind.CONVERSATION_UPDATED,
            invocationId,
            state.iteration,
            conversationPayload));
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    events.add(checkpointEvent(state, checkpoint, invocationId));
    appendWithCheckpoint(state, "tool exchange", invocationId, checkpoint, events);
    state.sequence = checkpoint.lastSequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistModelReconciliationRequired(
      TurnState state, String invocationId) {
    long sequence = state.sequence + 1;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.MODEL_RECONCILIATION_REQUIRED,
            invocationId,
            state.iteration,
            save(state.modelReconciliation));
    appendWithCheckpoint(
        state,
        "model reconciliation",
        invocationId,
        checkpoint,
        List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistModelReconciliation(
      TurnState state,
      String invocationId,
      ModelReconciliationState reconciliation,
      ModelInvocationResponse response) {
    long sequence = state.sequence + 1;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("reconciliation", save(reconciliation));
    payload.put("hasOutput", response.output != null);
    payload.put("toolRequests", response.toolRequests == null ? 0 : response.toolRequests.size());
    payload.put("metadata", response.metadata);
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.MODEL_INVOCATION_RECONCILED,
            invocationId,
            state.iteration,
            payload);
    appendWithCheckpoint(
        state,
        "model reconciliation resolution",
        invocationId,
        checkpoint,
        List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistModelResponse(
      TurnState state, String invocationId, ModelInvocationResponse response) {
    long sequence = state.sequence + 1;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("hasOutput", response.output != null);
    payload.put("toolRequests", response.toolRequests == null ? 0 : response.toolRequests.size());
    payload.put(
        "nextPortability",
        response.nextContextState == null || response.nextContextState.portability == null
            ? null
            : response.nextContextState.portability.value);
    payload.put(
        "delegatedState",
        response.nextContextState == null
            ? null
            : saveReferences(response.nextContextState.delegatedState));
    payload.put("metadata", response.metadata);
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.MODEL_INVOCATION_COMPLETED,
            invocationId,
            state.iteration,
            payload);
    appendWithCheckpoint(
        state,
        "model response",
        invocationId,
        checkpoint,
        List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistToolResult(
      TurnState state, String invocationId, ModelToolRequest request) {
    long sequence = state.sequence + 1;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    ModelToolResult result = state.toolResults.get(state.toolResults.size() - 1);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("toolResult", save(result));
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.TOOL_EXECUTION_COMPLETED,
            invocationId,
            state.iteration,
            payload);
    appendWithCheckpoint(
        state,
        "tool result",
        request.id,
        checkpoint,
        List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private EngineCheckpoint persistReconciliation(TurnState state, ModelToolResult result) {
    long sequence = state.sequence + 1;
    EngineCheckpoint checkpoint = buildCheckpoint(state, sequence, false);
    String invocationId =
        state.activeInvocationId == null ? "reconciliation" : state.activeInvocationId;
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("toolResult", save(result));
    EngineEvent event =
        buildEvent(
            state,
            sequence,
            EngineEventKind.TOOL_RESULT_RECONCILED,
            invocationId,
            state.iteration,
            payload);
    appendWithCheckpoint(
        state,
        "tool reconciliation",
        result.requestId,
        checkpoint,
        List.of(event, checkpointEvent(state, checkpoint, invocationId)));
    state.sequence = sequence + 1;
    return checkpoint;
  }

  private void appendWithCheckpoint(
      TurnState state,
      String stage,
      String requestId,
      EngineCheckpoint checkpoint,
      List<EngineEvent> events) {
    try {
      effects.durability.appendWithCheckpoint(events, checkpoint);
    } catch (PortException source) {
      throw new TurnEngineException.RecoveryRequired(
          stage, requestId, checkpoint, new ArrayList<>(state.toolResults), source);
    }
  }

  private EngineEvent checkpointEvent(
      TurnState state, EngineCheckpoint checkpoint, String invocationId) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("checkpointId", checkpoint.id);
    payload.put("includedThroughSequence", checkpoint.lastSequence);
    return buildEvent(
        state,
        checkpoint.lastSequence + 1,
        EngineEventKind.CHECKPOINT_CREATED,
        invocationId,
        checkpoint.iteration,
        payload);
  }

  private EngineCheckpoint buildCheckpoint(
      TurnState state, long lastSequence, boolean resumeSameIteration) {
    EngineCheckpoint checkpoint = new EngineCheckpoint();
    checkpoint.id = effects.ids.nextId("checkpoint");
    checkpoint.sessionId = state.sessionId;
    checkpoint.turnId = state.turnId;
    checkpoint.runId = state.runId;
    checkpoint.parentRunId = state.parentRunId;
    checkpoint.delegationDepth = state.delegationDepth;
    checkpoint.iteration = state.iteration;
    checkpoint.lastSequence = lastSequence;
    checkpoint.messages = new ArrayList<>(state.messages);
    checkpoint.stablePrefixMessages = state.stablePrefixMessages;
    checkpoint.inputs = state.inputs;
    checkpoint.activeInvocationId = state.activeInvocationId;
    checkpoint.pendingToolRequests = new ArrayList<>(state.pendingToolRequests);
    checkpoint.completedToolResults = new ArrayList<>(state.toolResults);
    checkpoint.completedModelIterations = state.completedModelIterations;
    // An indeterminate result blocks resumption even if the flag has not been raised yet:
    // the checkpoint is written before the engine reaches its own reconciliation branch.
    boolean lastIsIndeterminate =
        !state.toolResults.isEmpty()
            && state.toolResults.get(state.toolResults.size() - 1).outcome
                == ModelToolOutcome.INDETERMINATE;
    checkpoint.reconciliationRequired = state.reconciliationRequired || lastIsIndeterminate;
    checkpoint.modelReconciliation = state.modelReconciliation;
    checkpoint.pendingOutput = state.pendingOutput;
    checkpoint.finalOutputReady = state.finalOutputReady;
    checkpoint.pendingModelResponse = state.pendingModelResponse;
    checkpoint.resumeSameIteration = resumeSameIteration;
    checkpoint.policyAppliedForIteration = state.policyAppliedForIteration;
    checkpoint.contextState = currentContextState(state);
    return checkpoint;
  }

  private static InvocationContextState currentContextState(TurnState state) {
    InvocationContextState contextState = new InvocationContextState();
    contextState.portability = state.portability;
    contextState.delegatedState = new ArrayList<>(state.delegatedState);
    return contextState;
  }

  private TurnEngineResult applyFinalPolicy(TurnState state, CancellationToken cancellation) {
    if (cancellation.isCancelled()) {
      return commitCancelled(state, cancellation);
    }
    FinalOutputPolicyRequest request = new FinalOutputPolicyRequest();
    request.sessionId = state.sessionId;
    request.turnId = state.turnId;
    request.iteration = state.iteration;
    request.messages = new ArrayList<>(state.messages);
    request.output = state.output;
    request.inputs = state.inputs;

    FinalOutputPolicyResult result;
    try {
      result = effects.policy.beforeCommit(request, cancellation);
    } catch (HostPolicyException e) {
      if (cancellation.isCancelled()) {
        return commitCancelled(state, cancellation);
      }
      return commitFailed(state, e.errorKind(), e.getMessage(), cancellation);
    }
    if (cancellation.isCancelled()) {
      return commitCancelled(state, cancellation);
    }
    state.output = result.output;
    return commit(state, EngineTurnStatus.SUCCESS, EngineEventKind.TURN_COMMITTED, cancellation);
  }

  private TurnEngineResult commitCancelled(TurnState state, CancellationToken cancellation) {
    return commit(state, EngineTurnStatus.CANCELLED, EngineEventKind.TURN_CANCELLED, cancellation);
  }

  private TurnEngineResult commitFailed(
      TurnState state, String errorKind, String message, CancellationToken cancellation) {
    state.output = errorOutput(errorKind, message);
    return commit(state, EngineTurnStatus.FAILED, EngineEventKind.TURN_FAILED, cancellation);
  }

  private TurnEngineResult commitReconciliation(
      TurnState state, String errorKind, String message, CancellationToken cancellation) {
    state.output = errorOutput(errorKind, message);
    return commit(
        state,
        EngineTurnStatus.RECONCILIATION_REQUIRED,
        EngineEventKind.TURN_RECONCILIATION_REQUIRED,
        cancellation);
  }

  private static Map<String, Object> errorOutput(String errorKind, String message) {
    Map<String, Object> output = new LinkedHashMap<>();
    output.put("errorKind", errorKind);
    output.put("message", message);
    return output;
  }

  /**
   * Emit the terminal event, build the commit, and — only on success — run the post-commit effect.
   *
   * <p>Post-commit failures are deliberately non-fatal. The turn is already committed by the time it
   * runs, so reporting a failure as the turn's outcome would misrepresent what happened; it is
   * returned alongside the commit instead.
   */
  private TurnEngineResult commit(
      TurnState state,
      EngineTurnStatus status,
      EngineEventKind kind,
      CancellationToken cancellation) {
    int iteration = state.iteration;
    Map<String, Object> terminalPayload = new LinkedHashMap<>();
    terminalPayload.put("status", status.value);
    terminalPayload.put("output", state.output);
    emit(state, kind, null, iteration, terminalPayload);

    TurnCommit commit = new TurnCommit();
    commit.sessionId = state.sessionId;
    commit.turnId = state.turnId;
    commit.status = status;
    commit.output = state.output;
    commit.messages = new ArrayList<>(state.messages);
    commit.iterations = state.completedModelIterations;
    commit.lastSequence = state.sequence;
    commit.contextState = currentContextState(state);
    commit.modelReconciliation = state.modelReconciliation;

    String postCommitError = null;
    if (status == EngineTurnStatus.SUCCESS) {
      // Length-prefixed so no pair of session and turn identifiers can collide into the
      // same effect id, which is what makes the effect idempotent across resumes.
      String effectId =
          "post_commit:"
              + commit.sessionId.length()
              + ":"
              + commit.sessionId
              + ":"
              + commit.turnId.length()
              + ":"
              + commit.turnId;
      Map<String, Object> effectPayload = new LinkedHashMap<>();
      effectPayload.put("effectId", effectId);
      try {
        emit(state, EngineEventKind.POST_COMMIT_STARTED, null, iteration, effectPayload);
        try {
          effects.postCommit.afterCommit(effectId, commit, cancellation);
          try {
            emit(state, EngineEventKind.POST_COMMIT_COMPLETED, null, iteration, effectPayload);
          } catch (TurnEngineException e) {
            postCommitError =
                "post-commit effect '"
                    + effectId
                    + "' completed, but its completion event could not be persisted: "
                    + e.getMessage();
          }
        } catch (PortException source) {
          String message = source.getMessage();
          Map<String, Object> failedPayload = new LinkedHashMap<>();
          failedPayload.put("effectId", effectId);
          failedPayload.put("message", message);
          try {
            emit(state, EngineEventKind.POST_COMMIT_FAILED, null, iteration, failedPayload);
            postCommitError = message;
          } catch (TurnEngineException e) {
            postCommitError =
                message
                    + "; failure event for post-commit effect '"
                    + effectId
                    + "' could not be persisted: "
                    + e.getMessage();
          }
        }
      } catch (TurnEngineException e) {
        postCommitError =
            "post-commit effect '"
                + effectId
                + "' was not started because its start event could not be persisted: "
                + e.getMessage();
      }
    }
    // Re-read: post-commit events advance the journal past where the commit was built.
    commit.lastSequence = state.sequence;

    TurnEngineResult result = new TurnEngineResult();
    result.commit = commit;
    result.snapshots = new ArrayList<>(state.snapshots);
    result.toolResults = new ArrayList<>(state.toolResults);
    result.postCommitError = postCommitError;
    return result;
  }

  private void emit(
      TurnState state,
      EngineEventKind kind,
      String invocationId,
      Integer iteration,
      Object payload) {
    long sequence = state.sequence + 1;
    EngineEvent event = buildEvent(state, sequence, kind, invocationId, iteration, payload);
    try {
      effects.durability.append(event);
    } catch (PortException source) {
      throw new TurnEngineException.Port("event journal", source);
    }
    state.sequence = sequence;
  }

  private EngineEvent buildEvent(
      TurnState state,
      long sequence,
      EngineEventKind kind,
      String invocationId,
      Integer iteration,
      Object payload) {
    EngineEvent event = new EngineEvent();
    event.sequence = sequence;
    event.id = effects.ids.nextId("event");
    event.timestamp = effects.clock.now();
    event.sessionId = state.sessionId;
    event.turnId = state.turnId;
    event.runId = state.runId;
    event.parentRunId = state.parentRunId;
    event.delegationDepth = state.delegationDepth;
    event.invocationId = invocationId;
    event.iteration = iteration;
    event.kind = kind;
    event.payload = payload;
    return event;
  }

  private static Map<String, Object> save(ModelInvocationContextSnapshot value) {
    return value == null ? null : value.save(new SaveContext());
  }

  private static Map<String, Object> save(ModelToolRequest value) {
    return value == null ? null : value.save(new SaveContext());
  }

  private static Map<String, Object> save(ModelToolResult value) {
    return value == null ? null : value.save(new SaveContext());
  }

  private static Map<String, Object> save(EnginePermissionDecision value) {
    return value == null ? null : value.save(new SaveContext());
  }

  private static Map<String, Object> save(ModelReconciliationState value) {
    return value == null ? null : value.save(new SaveContext());
  }

  private static List<Map<String, Object>> saveMessages(List<Message> values) {
    if (values == null) {
      return null;
    }
    SaveContext context = new SaveContext();
    List<Map<String, Object>> saved = new ArrayList<>(values.size());
    for (Message value : values) {
      saved.add(value.save(context));
    }
    return saved;
  }

  private static List<Map<String, Object>> saveReferences(List<DelegatedStateReference> values) {
    if (values == null) {
      return null;
    }
    SaveContext context = new SaveContext();
    List<Map<String, Object>> saved = new ArrayList<>(values.size());
    for (DelegatedStateReference value : values) {
      saved.add(value.save(context));
    }
    return saved;
  }

  /** The turn was cancelled part-way through a tool request. */
  private static final class ToolCancelled extends RuntimeException {
    private static final long serialVersionUID = 1L;

    ToolCancelled() {
      super(null, null, false, false);
    }
  }

  /** The permission port itself failed, as distinct from denying the request. */
  private static final class ToolPermissionFailed extends RuntimeException {
    private static final long serialVersionUID = 1L;

    ToolPermissionFailed(PortException cause) {
      super(cause.getMessage(), cause, false, false);
    }
  }

  /** The tool request is malformed, so neither retrying nor the model can recover. */
  private static final class ToolConfigurationFailed extends RuntimeException {
    private static final long serialVersionUID = 1L;

    ToolConfigurationFailed(PortException cause) {
      super(cause.getMessage(), cause, false, false);
    }
  }
}
