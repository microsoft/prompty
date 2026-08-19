package com.microsoft.prompty.engine;

import com.microsoft.prompty.model.DelegatedStateReference;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelReconciliationState;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import java.util.ArrayList;
import java.util.List;

/**
 * Mutable state for one engine run.
 *
 * <p>Package-private on purpose: every field here is either recoverable from a checkpoint or
 * derivable from the journal, so nothing outside the engine should be reading it directly.
 */
final class TurnState {

  String sessionId;
  String turnId;
  String runId;
  String parentRunId;
  int delegationDepth;
  List<Message> messages;
  Object inputs;
  int maxIterations;
  int maxModelAttempts;
  int stablePrefixMessages;
  InvocationContextPortability portability;
  List<DelegatedStateReference> delegatedState;
  String activeInvocationId;
  List<ModelToolRequest> pendingToolRequests;
  boolean reconciliationRequired;
  ModelReconciliationState modelReconciliation;
  int completedModelIterations;
  Object pendingOutput;
  boolean finalOutputReady;
  ModelInvocationResponse pendingModelResponse;
  boolean policyAppliedForIteration;
  ModelToolResult reconciliationResolution;
  ModelInvocationResponse modelReconciliationResolution;
  int iteration;
  long sequence;
  Object output;
  final List<ModelInvocationContextSnapshot> snapshots = new ArrayList<>();
  List<ModelToolResult> toolResults;

  TurnState(TurnEngineRequest request) {
    sessionId = request.sessionId;
    turnId = request.turnId;
    runId = request.runId;
    parentRunId = request.parentRunId;
    delegationDepth = request.delegationDepth;
    messages = new ArrayList<>(request.messages);
    inputs = request.inputs;
    maxIterations = request.maxIterations;
    maxModelAttempts = request.maxModelAttempts;
    stablePrefixMessages = request.stablePrefixMessages;
    portability =
        request.portability == null ? InvocationContextPortability.PORTABLE : request.portability;
    delegatedState =
        request.delegatedState == null ? new ArrayList<>() : new ArrayList<>(request.delegatedState);
    activeInvocationId = request.activeInvocationId;
    pendingToolRequests =
        request.pendingToolRequests == null
            ? new ArrayList<>()
            : new ArrayList<>(request.pendingToolRequests);
    iteration = request.startIteration;
    sequence = request.initialSequence;
    toolResults =
        request.completedToolResults == null
            ? new ArrayList<>()
            : new ArrayList<>(request.completedToolResults);
    reconciliationRequired = request.reconciliationRequired;
    modelReconciliation = request.modelReconciliation;
    completedModelIterations = request.completedModelIterations;
    pendingOutput = request.pendingOutput;
    finalOutputReady = request.finalOutputReady;
    pendingModelResponse = request.pendingModelResponse;
    policyAppliedForIteration = request.policyAppliedForIteration;
    reconciliationResolution = request.reconciliationResolution;
    modelReconciliationResolution = request.modelReconciliationResolution;
  }

  /**
   * Fold a model response into canonical state.
   *
   * <p>Returns a message describing why the response is unusable, or null on success. It is a
   * message rather than an exception because the caller turns it into a committed failed turn, not
   * into a thrown error.
   *
   * <p>The response is held back rather than appended when it requested tools: the assistant
   * message and its tool results have to enter the conversation together, or a provider that
   * validates pairing will reject the next request.
   */
  String applyModelResponse(String invocationId, ModelInvocationResponse response) {
    completedModelIterations++;
    List<ModelToolRequest> toolRequests =
        response.toolRequests == null ? new ArrayList<>() : new ArrayList<>(response.toolRequests);
    if (toolRequests.isEmpty()) {
      if (response.assistantMessages != null) {
        messages.addAll(response.assistantMessages);
      }
      pendingModelResponse = null;
    } else {
      pendingModelResponse = response;
    }
    String error = applyProviderState(response);
    if (error != null) {
      return error;
    }
    activeInvocationId = invocationId;
    pendingToolRequests = toolRequests;
    pendingOutput = response.output;
    finalOutputReady = pendingToolRequests.isEmpty();
    return null;
  }

  /**
   * Adopt the provider's view of where conversation state now lives.
   *
   * <p>A response that names a next state replaces ours outright. A response that stays silent while
   * we are portable clears any stale references, because portable state by definition holds none.
   *
   * <p>The two rejections below are what keep a turn replayable: portable state pointing at
   * provider-held data cannot be moved, and delegated state naming no data cannot be resumed.
   */
  private String applyProviderState(ModelInvocationResponse response) {
    if (response.nextContextState != null) {
      portability =
          response.nextContextState.portability == null
              ? InvocationContextPortability.PORTABLE
              : response.nextContextState.portability;
      delegatedState =
          response.nextContextState.delegatedState == null
              ? new ArrayList<>()
              : new ArrayList<>(response.nextContextState.delegatedState);
    } else if (portability == InvocationContextPortability.PORTABLE) {
      delegatedState.clear();
    }

    if (portability == InvocationContextPortability.PORTABLE && !delegatedState.isEmpty()) {
      return "portable provider state cannot retain delegated references";
    }
    if (portability == InvocationContextPortability.DELEGATED && delegatedState.isEmpty()) {
      return "delegated provider state requires at least one reference";
    }
    return null;
  }
}
