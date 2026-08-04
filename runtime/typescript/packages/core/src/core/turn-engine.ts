/**
 * Canonical, provider-neutral TypeScript turn state machine.
 *
 * Generated Typra models are the durable contract. This module owns only
 * runtime orchestration state, native effect ports, and recovery errors.
 */

import { Message } from "../model/conversation/message.js";
import { ContextRequest } from "../model/pipeline/context-request.js";
import { DelegatedStateReference } from "../model/pipeline/delegated-state-reference.js";
import { EngineCheckpoint } from "../model/pipeline/engine-checkpoint.js";
import {
  EngineEvent,
  type EngineEventKind,
} from "../model/pipeline/engine-event.js";
import { EnginePermissionDecision } from "../model/pipeline/engine-permission-decision.js";
import { FinalOutputPolicyRequest } from "../model/pipeline/final-output-policy-request.js";
import { HostPolicyRequest } from "../model/pipeline/host-policy-request.js";
import { InvocationContextState } from "../model/pipeline/invocation-context-state.js";
import { ModelInvocationContextSnapshot } from "../model/pipeline/model-invocation-context-snapshot.js";
import { ModelInvocationRequest } from "../model/pipeline/model-invocation-request.js";
import { ModelInvocationResponse } from "../model/pipeline/model-invocation-response.js";
import { ModelReconciliationState } from "../model/pipeline/model-reconciliation-state.js";
import { ModelToolRequest } from "../model/pipeline/model-tool-request.js";
import { ModelToolResult } from "../model/pipeline/model-tool-result.js";
import { ResumeContext } from "../model/pipeline/resume-context.js";
import { RetryPolicyRequest } from "../model/pipeline/retry-policy-request.js";
import {
  TurnCommit,
  type EngineTurnStatus,
} from "../model/pipeline/turn-commit.js";
import { TurnEngineResult } from "../model/pipeline/turn-engine-result.js";
import {
  TurnCancellationError,
  TurnCancellationToken,
} from "./turn-engine-cancellation.js";
import { ContextPipeline, TurnContextError } from "./turn-engine-context.js";
import {
  AllowAllPermissionPort,
  type Clock,
  type ConversationPort,
  DefaultConversationPort,
  DefaultIdGenerator,
  type DurabilityPort,
  type HostPolicyPort,
  type IdGenerator,
  type ModelPort,
  type ModelStreamPort,
  NoopDurabilityPort,
  NoopHostPolicyPort,
  NoopModelStreamPort,
  NoopPostCommitPort,
  NoopRetryPolicyPort,
  normalizePortError,
  type PermissionPort,
  type PostCommitPort,
  type RetryPolicyPort,
  SystemClock,
  type ToolPort,
  TurnHostPolicyError,
  TurnPortError,
  UnavailableToolPort,
  modelVisibleToolOutput,
  toolResultMessage,
} from "./turn-engine-ports.js";

export class TurnEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnEngineError";
  }
}

export class InvalidTurnRequestError extends TurnEngineError {
  constructor(message: string) {
    super(`Invalid turn request: ${message}`);
    this.name = "InvalidTurnRequestError";
  }
}

export class TurnEnginePortError extends TurnEngineError {
  readonly stage: string;

  constructor(stage: string, cause: unknown) {
    const source = normalizePortError(cause);
    super(`${stage} failed: ${source.message}`, { cause: source });
    this.name = "TurnEnginePortError";
    this.stage = stage;
  }
}

/**
 * Atomic persistence failed after an external effect completed.
 *
 * The checkpoint and completed results are explicit recovery state and must be
 * persisted/reconciled rather than treating the operation as retryable.
 */
export class TurnEngineRecoveryRequiredError extends TurnEngineError {
  readonly stage: string;
  readonly requestId: string;
  readonly checkpoint: EngineCheckpoint;
  readonly toolResults: readonly ModelToolResult[];

  constructor(options: {
    stage: string;
    requestId: string;
    checkpoint: EngineCheckpoint;
    toolResults: readonly ModelToolResult[];
    cause: unknown;
  }) {
    const source = normalizePortError(options.cause);
    super(
      `${options.stage} durability failed after effect '${options.requestId}': ${source.message}`,
      { cause: source },
    );
    this.name = "TurnEngineRecoveryRequiredError";
    this.stage = options.stage;
    this.requestId = options.requestId;
    this.checkpoint = options.checkpoint;
    this.toolResults = options.toolResults;
  }
}

export interface TurnEngineRequestInit {
  sessionId: string;
  turnId: string;
  messages: readonly Message[];
  runId?: string;
  parentRunId?: string;
  delegationDepth?: number;
  inputs?: unknown;
  maxIterations?: number;
  maxModelAttempts?: number;
  startIteration?: number;
  initialSequence?: number;
  stablePrefixMessages?: number;
  contextState?: InvocationContextState;
  activeInvocationId?: string;
  pendingToolRequests?: readonly ModelToolRequest[];
  completedToolResults?: readonly ModelToolResult[];
  completedModelIterations?: number;
  reconciliationRequired?: boolean;
  modelReconciliation?: ModelReconciliationState;
  pendingOutput?: unknown;
  finalOutputReady?: boolean;
  pendingModelResponse?: ModelInvocationResponse;
  policyAppliedForIteration?: boolean;
  committedToolResultIds?: readonly string[];
}

/** Runtime request state. Durable nested values remain generated model types. */
export class TurnEngineRequest {
  readonly sessionId: string;
  readonly turnId: string;
  readonly messages: Message[];
  runId: string;
  readonly parentRunId?: string;
  readonly delegationDepth: number;
  readonly inputs?: unknown;
  readonly maxIterations: number;
  readonly maxModelAttempts: number;
  startIteration: number;
  readonly initialSequence: number;
  readonly stablePrefixMessages: number;
  readonly contextState: InvocationContextState;
  readonly activeInvocationId?: string;
  readonly pendingToolRequests: ModelToolRequest[];
  readonly completedToolResults: ModelToolResult[];
  readonly completedModelIterations: number;
  reconciliationRequired: boolean;
  readonly modelReconciliation?: ModelReconciliationState;
  readonly pendingOutput?: unknown;
  readonly finalOutputReady: boolean;
  readonly pendingModelResponse?: ModelInvocationResponse;
  readonly policyAppliedForIteration: boolean;
  readonly committedToolResultIds: string[];
  reconciliationResolution?: ModelToolResult;
  modelReconciliationResolution?: ModelInvocationResponse;

  constructor(init: TurnEngineRequestInit) {
    this.sessionId = init.sessionId;
    this.turnId = init.turnId;
    this.messages = [...init.messages];
    this.runId = init.runId ?? "";
    this.parentRunId = init.parentRunId;
    this.delegationDepth = init.delegationDepth ?? 0;
    this.inputs = init.inputs;
    this.maxIterations = init.maxIterations ?? 10;
    this.maxModelAttempts = init.maxModelAttempts ?? 3;
    this.startIteration = init.startIteration ?? 0;
    this.initialSequence = init.initialSequence ?? 0;
    this.stablePrefixMessages =
      init.stablePrefixMessages ?? init.messages.length;
    this.contextState =
      init.contextState ?? new InvocationContextState({ portability: "portable" });
    this.activeInvocationId = init.activeInvocationId;
    this.pendingToolRequests = [...(init.pendingToolRequests ?? [])];
    this.completedToolResults = [...(init.completedToolResults ?? [])];
    this.completedModelIterations = init.completedModelIterations ?? 0;
    this.reconciliationRequired = init.reconciliationRequired ?? false;
    this.modelReconciliation = init.modelReconciliation;
    this.pendingOutput = init.pendingOutput;
    this.finalOutputReady = init.finalOutputReady ?? false;
    this.pendingModelResponse = init.pendingModelResponse;
    this.policyAppliedForIteration =
      init.policyAppliedForIteration ?? false;
    this.committedToolResultIds = [...(init.committedToolResultIds ?? [])];
  }

  static fromResume(resume: ResumeContext): TurnEngineRequest {
    const checkpoint = resume.checkpoint;
    const hasFinishedIteration =
      (checkpoint.pendingToolRequests ?? []).length === 0 &&
      checkpoint.pendingModelResponse === undefined &&
      !checkpoint.finalOutputReady &&
      !checkpoint.reconciliationRequired;
    const startIteration = checkpoint.resumeSameIteration
      ? checkpoint.iteration
      : hasFinishedIteration
        ? checkpoint.iteration + 1
        : checkpoint.iteration;

    return new TurnEngineRequest({
      sessionId: checkpoint.sessionId,
      turnId: checkpoint.turnId,
      messages: checkpoint.messages,
      runId: checkpoint.runId,
      parentRunId: checkpoint.parentRunId,
      delegationDepth: checkpoint.delegationDepth,
      inputs: checkpoint.inputs,
      maxIterations: resume.maxIterations,
      maxModelAttempts:
        resume.maxModelAttempts > 0 ? resume.maxModelAttempts : 3,
      startIteration,
      initialSequence: Math.max(
        checkpoint.lastSequence,
        resume.lastJournalSequence,
      ),
      stablePrefixMessages: checkpoint.stablePrefixMessages,
      contextState: checkpoint.contextState,
      activeInvocationId: checkpoint.activeInvocationId,
      pendingToolRequests: checkpoint.pendingToolRequests ?? [],
      completedToolResults: checkpoint.completedToolResults ?? [],
      completedModelIterations: checkpoint.completedModelIterations,
      reconciliationRequired: checkpoint.reconciliationRequired,
      modelReconciliation: checkpoint.modelReconciliation,
      pendingOutput: checkpoint.pendingOutput,
      finalOutputReady: checkpoint.finalOutputReady,
      pendingModelResponse: checkpoint.pendingModelResponse,
      policyAppliedForIteration: checkpoint.policyAppliedForIteration,
      committedToolResultIds: checkpointCommittedToolResultIds(checkpoint),
    });
  }

  static afterToolReconciliation(
    resume: ResumeContext,
    resolvedResult: ModelToolResult,
  ): TurnEngineRequest {
    const checkpoint = cloneCheckpoint(resume.checkpoint);
    if (!checkpoint.reconciliationRequired) {
      throw new InvalidTurnRequestError(
        "checkpoint does not require reconciliation",
      );
    }
    if (checkpoint.modelReconciliation) {
      throw new InvalidTurnRequestError(
        "checkpoint requires model reconciliation, not tool reconciliation",
      );
    }
    if (resolvedResult.outcome === "indeterminate") {
      throw new InvalidTurnRequestError(
        "resolved tool result must have a determinate outcome",
      );
    }
    const results = checkpoint.completedToolResults ?? [];
    const index = results.findIndex(
      (result) => result.requestId === resolvedResult.requestId,
    );
    if (index < 0) {
      throw new InvalidTurnRequestError(
        `checkpoint does not contain indeterminate tool request '${resolvedResult.requestId}'`,
      );
    }
    if (results[index].outcome !== "indeterminate") {
      throw new InvalidTurnRequestError(
        `tool request '${resolvedResult.requestId}' is already determinate`,
      );
    }
    results[index] = resolvedResult;
    if (!checkpoint.pendingModelResponse) {
      const messageIndex = checkpoint.messages.findIndex(
        (message) =>
          message.metadata["tool_call_id"] === resolvedResult.requestId,
      );
      if (messageIndex < 0) {
        throw new InvalidTurnRequestError(
          `checkpoint is missing the tool result message for '${resolvedResult.requestId}'`,
        );
      }
      checkpoint.messages[messageIndex] = toolResultMessage(
        resolvedResult.requestId,
        modelVisibleToolOutput(resolvedResult),
      );
    }
    checkpoint.reconciliationRequired = false;
    const request = TurnEngineRequest.fromResume(
      new ResumeContext({
        checkpoint,
        maxIterations: resume.maxIterations,
        maxModelAttempts: resume.maxModelAttempts,
        lastJournalSequence: resume.lastJournalSequence,
        metadata: resume.metadata,
      }),
    );
    request.reconciliationResolution = resolvedResult;
    return request;
  }

  static afterModelReconciliation(
    resume: ResumeContext,
    resolvedResponse: ModelInvocationResponse,
  ): TurnEngineRequest {
    const checkpoint = resume.checkpoint;
    if (!checkpoint.reconciliationRequired) {
      throw new InvalidTurnRequestError(
        "checkpoint does not require reconciliation",
      );
    }
    const reconciliation = checkpoint.modelReconciliation;
    if (!reconciliation) {
      throw new InvalidTurnRequestError(
        "checkpoint requires tool reconciliation, not model reconciliation",
      );
    }
    if (checkpoint.activeInvocationId !== reconciliation.invocationId) {
      throw new InvalidTurnRequestError(
        "model reconciliation identity does not match the active invocation",
      );
    }

    const request = TurnEngineRequest.fromResume(resume);
    request.startIteration = checkpoint.iteration;
    request.reconciliationRequired = false;
    request.modelReconciliationResolution = resolvedResponse;
    return request;
  }
}

export interface TurnEngineEffects {
  model: ModelPort;
  stream?: ModelStreamPort;
  policy?: HostPolicyPort;
  retry?: RetryPolicyPort;
  conversation?: ConversationPort;
  permission?: PermissionPort;
  tools?: ToolPort;
  durability?: DurabilityPort;
  postCommit?: PostCommitPort;
  clock?: Clock;
  ids?: IdGenerator;
}

interface ResolvedTurnEngineEffects {
  model: ModelPort;
  stream: ModelStreamPort;
  policy: HostPolicyPort;
  retry: RetryPolicyPort;
  conversation: ConversationPort;
  permission: PermissionPort;
  tools: ToolPort;
  durability: DurabilityPort;
  postCommit: PostCommitPort;
  clock: Clock;
  ids: IdGenerator;
}

/** One canonical orchestration loop for live and deterministic execution. */
export class TurnEngine {
  readonly #context: ContextPipeline;
  readonly #effects: ResolvedTurnEngineEffects;

  constructor(context: ContextPipeline, effects: TurnEngineEffects) {
    this.#context = context;
    this.#effects = {
      model: effects.model,
      stream: effects.stream ?? new NoopModelStreamPort(),
      policy: effects.policy ?? new NoopHostPolicyPort(),
      retry: effects.retry ?? new NoopRetryPolicyPort(),
      conversation: effects.conversation ?? new DefaultConversationPort(),
      permission: effects.permission ?? new AllowAllPermissionPort(),
      tools: effects.tools ?? new UnavailableToolPort(),
      durability: effects.durability ?? new NoopDurabilityPort(),
      postCommit: effects.postCommit ?? new NoopPostCommitPort(),
      clock: effects.clock ?? new SystemClock(),
      ids: effects.ids ?? new DefaultIdGenerator(),
    };
  }

  async resume(
    resume: ResumeContext,
    cancellation = new TurnCancellationToken(),
  ): Promise<TurnEngineResult> {
    return this.run(TurnEngineRequest.fromResume(resume), cancellation);
  }

  async resumeAfterToolReconciliation(
    resume: ResumeContext,
    resolvedResult: ModelToolResult,
    cancellation = new TurnCancellationToken(),
  ): Promise<TurnEngineResult> {
    return this.run(
      TurnEngineRequest.afterToolReconciliation(resume, resolvedResult),
      cancellation,
    );
  }

  async resumeAfterModelReconciliation(
    resume: ResumeContext,
    resolvedResponse: ModelInvocationResponse,
    cancellation = new TurnCancellationToken(),
  ): Promise<TurnEngineResult> {
    return this.run(
      TurnEngineRequest.afterModelReconciliation(resume, resolvedResponse),
      cancellation,
    );
  }

  async run(
    request: TurnEngineRequest,
    cancellation = new TurnCancellationToken(),
  ): Promise<TurnEngineResult> {
    this.#validateRequest(request);
    if (!request.runId) {
      request.runId = this.#effects.ids.nextId("run");
    }
    const state = new TurnState(request);
    await this.#emit(state, "turn_started", {
      payload: {
        maxIterations: state.maxIterations,
        startIteration: state.iteration,
        inputs: state.inputs,
      },
    });

    if (state.modelReconciliationResolution) {
      const response = state.modelReconciliationResolution;
      state.modelReconciliationResolution = undefined;
      const reconciliation = state.modelReconciliation;
      if (!reconciliation) {
        throw new InvalidTurnRequestError(
          "model reconciliation response is missing durable reconciliation state",
        );
      }
      state.reconciliationRequired = false;
      state.modelReconciliation = undefined;
      try {
        state.applyModelResponse(reconciliation.invocationId, response);
      } catch (error) {
        return this.#commitFailure(
          state,
          "provider_state_error",
          errorMessage(error),
          cancellation,
        );
      }
      await this.#persistModelReconciliation(
        state,
        reconciliation.invocationId,
        reconciliation,
        response,
      );
    }

    if (state.reconciliationResolution) {
      const resolution = state.reconciliationResolution;
      state.reconciliationResolution = undefined;
      await this.#persistToolReconciliation(state, resolution);
    }

    if (state.reconciliationRequired) {
      return this.#commitReconciliation(
        state,
        "effect_outcome_unknown",
        "Checkpoint requires explicit effect reconciliation",
        cancellation,
      );
    }

    if (state.finalOutputReady) {
      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }
      state.output = state.pendingOutput;
      return this.#applyFinalPolicy(state, cancellation);
    }

    while (state.iteration < state.maxIterations) {
      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }

      if (
        state.pendingToolRequests.length === 0 &&
        state.pendingModelResponse
      ) {
        const invocationId =
          state.activeInvocationId ?? this.#effects.ids.nextId("invocation");
        let results: ModelToolResult[];
        try {
          results = this.#finalizeToolExchange(state);
        } catch (error) {
          return this.#commitFailure(
            state,
            "conversation_format_error",
            errorMessage(error),
            cancellation,
          );
        }
        await this.#persistToolExchange(state, invocationId, results);
        state.activeInvocationId = undefined;
        state.iteration += 1;
        continue;
      }

      if (state.pendingToolRequests.length > 0) {
        if (cancellation.isCancellationRequested) {
          return this.#commitCancellation(state, cancellation);
        }
        const invocationId =
          state.activeInvocationId ?? this.#effects.ids.nextId("invocation");
        const toolRequest = state.pendingToolRequests.shift()!;
        let execution: ToolExecution;
        try {
          execution = await this.#executeTool(
            state,
            invocationId,
            toolRequest,
            cancellation,
          );
        } catch (error) {
          if (
            error instanceof TurnCancellationError ||
            cancellation.isCancellationRequested
          ) {
            return this.#commitCancellation(state, cancellation);
          }
          if (error instanceof TurnPortError && error.configurationError) {
            return this.#commitFailure(
              state,
              "tool_configuration_error",
              error.message,
              cancellation,
            );
          }
          if (error instanceof TurnPortError) {
            return this.#commitFailure(
              state,
              "permission_error",
              error.message,
              cancellation,
            );
          }
          throw error;
        }

        const outcomeUnknown = execution.result.outcome === "indeterminate";
        state.toolResults.push(execution.result);
        if (!state.pendingModelResponse) {
          state.messages.push(
            toolResultMessage(
              toolRequest.id,
              modelVisibleToolOutput(execution.result),
            ),
          );
        }
        await this.#persistToolResult(
          state,
          invocationId,
          toolRequest,
          execution.executed,
        );
        if (outcomeUnknown) {
          state.reconciliationRequired = true;
          return this.#commitReconciliation(
            state,
            "effect_outcome_unknown",
            "Tool effect outcome is unknown and requires reconciliation",
            cancellation,
          );
        }
        if (
          state.pendingToolRequests.length === 0 &&
          !state.pendingModelResponse
        ) {
          state.activeInvocationId = undefined;
          state.iteration += 1;
        }
        continue;
      }

      const invocationId = this.#effects.ids.nextId("invocation");
      if (state.policyAppliedForIteration) {
        state.policyAppliedForIteration = false;
      } else {
        let policyResult;
        try {
          policyResult = await this.#effects.policy.beforeModel(
            new HostPolicyRequest({
              sessionId: state.sessionId,
              turnId: state.turnId,
              iteration: state.iteration,
              messages: state.messages,
              stablePrefixMessages: state.stablePrefixMessages,
              inputs: state.inputs,
            }),
            cancellation,
          );
        } catch (error) {
          if (cancellation.isCancellationRequested) {
            return this.#commitCancellation(state, cancellation);
          }
          const policyError =
            error instanceof TurnHostPolicyError
              ? error
              : new TurnHostPolicyError("policy_error", errorMessage(error), {
                  cause: error,
                });
          return this.#commitFailure(
            state,
            policyError.errorKind,
            policyError.message,
            cancellation,
          );
        }
        if (cancellation.isCancellationRequested) {
          return this.#commitCancellation(state, cancellation);
        }
        if (
          policyResult.stablePrefixMessages < 0 ||
          policyResult.stablePrefixMessages > policyResult.messages.length
        ) {
          return this.#commitFailure(
            state,
            "policy_error",
            "Host policy stable prefix exceeds rewritten message count",
            cancellation,
          );
        }
        const policyChanged =
          !messagesEqual(state.messages, policyResult.messages) ||
          state.stablePrefixMessages !== policyResult.stablePrefixMessages;
        if (policyChanged) {
          state.messages = [...policyResult.messages];
          state.stablePrefixMessages = policyResult.stablePrefixMessages;
          await this.#persistPolicyUpdate(
            state,
            invocationId,
            policyResult.metadata,
          );
          state.policyAppliedForIteration = false;
        }
      }

      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }
      const contextRequest = new ContextRequest({
        sessionId: state.sessionId,
        turnId: state.turnId,
        invocationId,
        iteration: state.iteration,
        messages: state.messages,
        stablePrefixMessages: Math.min(
          state.stablePrefixMessages,
          state.messages.length,
        ),
        contextState: new InvocationContextState({
          portability: state.portability,
          delegatedState: state.delegatedState,
        }),
        inputs: state.inputs,
      });
      let snapshot: ModelInvocationContextSnapshot;
      try {
        snapshot = await this.#context.prepare(contextRequest, cancellation);
      } catch (error) {
        if (
          error instanceof TurnCancellationError ||
          cancellation.isCancellationRequested
        ) {
          return this.#commitCancellation(state, cancellation);
        }
        return this.#commitFailure(
          state,
          "context_error",
          error instanceof TurnContextError ? error.message : errorMessage(error),
          cancellation,
        );
      }
      await this.#emit(state, "context_prepared", {
        invocationId,
        iteration: state.iteration,
        payload: snapshot.save(),
      });
      state.snapshots.push(snapshot);

      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }

      const modelRequest = new ModelInvocationRequest({ context: snapshot });
      state.activeInvocationId = invocationId;
      let attempt = 0;
      let modelResponse: ModelInvocationResponse | undefined;
      while (!modelResponse) {
        if (cancellation.isCancellationRequested) {
          return this.#commitCancellation(state, cancellation);
        }
        await this.#emit(state, "model_invocation_started", {
          invocationId,
          iteration: state.iteration,
          payload: {
            snapshotId: snapshot.id,
            attempt,
            messageCount: snapshot.messages.length,
          },
        });
        try {
          modelResponse = await this.#effects.model.invoke(
            modelRequest,
            cancellation,
            this.#effects.stream,
          );
        } catch (error) {
          if (cancellation.isCancellationRequested) {
            return this.#commitCancellation(state, cancellation);
          }
          const source = normalizePortError(error);
          const failedAttempt = attempt;
          attempt += 1;
          const exhausted =
            source.outcomeUnknown || attempt >= state.maxModelAttempts;
          await this.#emit(state, "model_invocation_failed", {
            invocationId,
            iteration: state.iteration,
            payload: {
              attempt: failedAttempt,
              exhausted,
              outcomeUnknown: source.outcomeUnknown,
              message: source.message,
            },
          });
          if (source.outcomeUnknown) {
            state.reconciliationRequired = true;
            state.modelReconciliation = new ModelReconciliationState({
              invocationId,
              request: modelRequest,
              failedAttempt,
              message: source.message,
              metadata: source.metadata,
            });
            await this.#persistModelReconciliationRequired(state, invocationId);
            return this.#commitReconciliation(
              state,
              "model_outcome_unknown",
              source.message,
              cancellation,
            );
          }
          if (exhausted) {
            return this.#commitFailure(
              state,
              "model_error",
              source.message,
              cancellation,
            );
          }
          try {
            await this.#effects.retry.backoff(
              new RetryPolicyRequest({
                failedAttempts: attempt,
                nextAttempt: attempt + 1,
                maxAttempts: state.maxModelAttempts,
                reason: source.message,
              }),
              cancellation,
            );
          } catch (retryError) {
            if (
              retryError instanceof TurnCancellationError ||
              cancellation.isCancellationRequested
            ) {
              return this.#commitCancellation(state, cancellation);
            }
            return this.#commitFailure(
              state,
              "retry_policy_error",
              errorMessage(retryError),
              cancellation,
            );
          }
          if (cancellation.isCancellationRequested) {
            return this.#commitCancellation(state, cancellation);
          }
        }
      }

      state.modelReconciliation = undefined;
      state.reconciliationRequired = false;
      try {
        state.applyModelResponse(invocationId, modelResponse);
      } catch (error) {
        return this.#commitFailure(
          state,
          "provider_state_error",
          errorMessage(error),
          cancellation,
        );
      }
      await this.#persistModelResponse(state, invocationId, modelResponse);

      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }
      if (state.finalOutputReady) {
        state.output = state.pendingOutput;
        return this.#applyFinalPolicy(state, cancellation);
      }
    }

    return this.#commitFailure(
      state,
      "max_iterations",
      "Maximum model iterations reached",
      cancellation,
    );
  }

  #validateRequest(request: TurnEngineRequest): void {
    if (!request.sessionId) {
      throw new InvalidTurnRequestError("sessionId is required");
    }
    if (!request.turnId) {
      throw new InvalidTurnRequestError("turnId is required");
    }
    if (request.maxModelAttempts <= 0) {
      throw new InvalidTurnRequestError(
        "maxModelAttempts must be greater than zero",
      );
    }
    if (request.maxIterations < 0) {
      throw new InvalidTurnRequestError(
        "maxIterations must not be negative",
      );
    }
    if (request.startIteration > request.maxIterations) {
      throw new InvalidTurnRequestError(
        "startIteration must not exceed maxIterations",
      );
    }
    if (
      request.stablePrefixMessages < 0 ||
      request.stablePrefixMessages > request.messages.length
    ) {
      throw new InvalidTurnRequestError(
        "stablePrefixMessages exceeds initial message count",
      );
    }
    if (
      request.contextState.portability === "portable" &&
      (request.contextState.delegatedState ?? []).length > 0
    ) {
      throw new InvalidTurnRequestError(
        "portable turns cannot begin with delegated provider state",
      );
    }
  }

  #finalizeToolExchange(state: TurnState): ModelToolResult[] {
    const response = state.pendingModelResponse;
    if (!response) {
      return [];
    }
    const requests = response.toolRequests ?? [];
    if (requests.length === 0) {
      state.pendingModelResponse = undefined;
      return [];
    }
    const results = requests.map((request) => {
      const result = state.toolResults.find(
        (candidate) => candidate.requestId === request.id,
      );
      if (!result) {
        throw TurnPortError.configuration(
          "Tool exchange is incomplete and cannot be formatted",
        );
      }
      return result;
    });
    const messages = this.#effects.conversation.formatToolExchange(
      response,
      results,
    );
    state.pendingModelResponse = undefined;
    state.messages.push(...messages);
    return results;
  }

  async #executeTool(
    state: TurnState,
    invocationId: string,
    request: ModelToolRequest,
    cancellation: TurnCancellationToken,
  ): Promise<ToolExecution> {
    cancellation.throwIfCancellationRequested();
    await this.#emit(state, "permission_requested", {
      invocationId,
      iteration: state.iteration,
      payload: { toolRequest: request.save() },
    });
    let decision: EnginePermissionDecision;
    try {
      decision = await this.#effects.permission.authorize(
        request,
        cancellation,
      );
    } catch (error) {
      throw normalizePortError(error);
    }
    await this.#emitPermissionResolved(state, invocationId, request, decision);
    if (!decision.approved) {
      const metadata = decision.metadata ?? {};
      return {
        executed: false,
        result: new ModelToolResult({
          requestId: request.id,
          name: request.name,
          outcome: "failed",
          output: decision.reason ?? "Permission denied",
          errorKind:
            typeof metadata["errorKind"] === "string"
              ? metadata["errorKind"]
              : "permission_denied",
          metadata,
        }),
      };
    }

    cancellation.throwIfCancellationRequested();
    await this.#emit(state, "tool_execution_started", {
      invocationId,
      iteration: state.iteration,
      payload: { toolRequest: request.save() },
    });
    cancellation.throwIfCancellationRequested();
    try {
      const result = await this.#effects.tools.execute(request, cancellation);
      if (result.requestId !== request.id || result.name !== request.name) {
        throw TurnPortError.configuration(
          `Tool '${request.name}' returned a result for '${result.requestId || "<empty>"}'`,
        );
      }
      return {
        executed: true,
        result,
      };
    } catch (error) {
      const source = normalizePortError(error);
      if (source.configurationError) {
        throw source;
      }
      return {
        executed: true,
        result: new ModelToolResult({
          requestId: request.id,
          name: request.name,
          outcome: source.outcomeUnknown ? "indeterminate" : "failed",
          output: source.outcomeUnknown
            ? `Tool '${request.name}' outcome is unknown and requires reconciliation: ${source.message}`
            : `Tool '${request.name}' failed: ${source.message}`,
          errorKind: source.outcomeUnknown
            ? "effect_outcome_unknown"
            : "tool_error",
          metadata: source.metadata,
        }),
      };
    }
  }

  async #persistPolicyUpdate(
    state: TurnState,
    invocationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    state.policyAppliedForIteration = true;
    const checkpoint = this.#buildCheckpoint(state, sequence, true);
    const event = this.#buildEvent(state, sequence, "policy_applied", {
      invocationId,
      iteration: state.iteration,
      payload: {
        messages: state.messages.map((message) => message.save()),
        stablePrefixMessages: state.stablePrefixMessages,
        metadata,
      },
    });
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    await this.#appendAtomic(
      state,
      [event, checkpointEvent],
      checkpoint,
      "host policy",
      invocationId,
    );
  }

  async #persistModelResponse(
    state: TurnState,
    invocationId: string,
    response: ModelInvocationResponse,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    const event = this.#buildEvent(
      state,
      sequence,
      "model_invocation_completed",
      {
        invocationId,
        iteration: state.iteration,
        payload: {
          hasOutput: response.output !== undefined,
          toolRequests: (response.toolRequests ?? []).length,
          nextPortability: response.nextContextState?.portability,
          delegatedState: response.nextContextState?.delegatedState?.map(
            (reference) => reference.save(),
          ),
          metadata: response.metadata,
        },
      },
    );
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    await this.#appendAtomic(
      state,
      [event, checkpointEvent],
      checkpoint,
      "model response",
      invocationId,
    );
  }

  async #persistModelReconciliationRequired(
    state: TurnState,
    invocationId: string,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    const event = this.#buildEvent(
      state,
      sequence,
      "model_reconciliation_required",
      {
        invocationId,
        iteration: state.iteration,
        payload: state.modelReconciliation?.save(),
      },
    );
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    await this.#appendAtomic(
      state,
      [event, checkpointEvent],
      checkpoint,
      "model reconciliation",
      invocationId,
    );
  }

  async #persistModelReconciliation(
    state: TurnState,
    invocationId: string,
    reconciliation: ModelReconciliationState,
    response: ModelInvocationResponse,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    const event = this.#buildEvent(
      state,
      sequence,
      "model_invocation_reconciled",
      {
        invocationId,
        iteration: state.iteration,
        payload: {
          reconciliation: reconciliation.save(),
          hasOutput: response.output !== undefined,
          toolRequests: (response.toolRequests ?? []).length,
          metadata: response.metadata,
        },
      },
    );
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    await this.#appendAtomic(
      state,
      [event, checkpointEvent],
      checkpoint,
      "model reconciliation resolution",
      invocationId,
    );
  }

  async #persistToolResult(
    state: TurnState,
    invocationId: string,
    request: ModelToolRequest,
    executed: boolean,
  ): Promise<void> {
    const result = state.toolResults[state.toolResults.length - 1];
    if (executed) {
      const sequence = state.sequence + 1;
      const checkpoint = this.#buildCheckpoint(state, sequence, false);
      const event = this.#buildEvent(
        state,
        sequence,
        "tool_execution_completed",
        {
          invocationId,
          iteration: state.iteration,
          payload: { toolResult: result.save() },
        },
      );
      const checkpointEvent = this.#buildCheckpointEvent(
        state,
        checkpoint,
        invocationId,
      );
      await this.#appendAtomic(
        state,
        [event, checkpointEvent],
        checkpoint,
        "tool result",
        request.id,
      );
      return;
    }

    // Denial is a committed model-visible result, never an execution-completed
    // event. Commit any earlier uncommitted results at the same boundary so
    // observable result order remains the original model-request order.
    let sequence = state.sequence;
    const events: EngineEvent[] = [];
    for (const candidate of state.toolResults) {
      if (state.committedToolResultIds.has(candidate.requestId)) {
        continue;
      }
      sequence += 1;
      events.push(
        this.#buildEvent(state, sequence, "tool_result_committed", {
          invocationId,
          iteration: state.iteration,
          payload: { toolResult: candidate.save() },
        }),
      );
      state.committedToolResultIds.add(candidate.requestId);
    }
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    events.push(checkpointEvent);
    await this.#appendAtomic(
      state,
      events,
      checkpoint,
      "permission result",
      request.id,
    );
  }

  async #persistToolExchange(
    state: TurnState,
    invocationId: string,
    results: readonly ModelToolResult[],
  ): Promise<void> {
    let sequence = state.sequence;
    const events: EngineEvent[] = [];
    for (const result of results) {
      if (state.committedToolResultIds.has(result.requestId)) {
        continue;
      }
      sequence += 1;
      events.push(
        this.#buildEvent(state, sequence, "tool_result_committed", {
          invocationId,
          iteration: state.iteration,
          payload: { toolResult: result.save() },
        }),
      );
      state.committedToolResultIds.add(result.requestId);
    }
    sequence += 1;
    events.push(
      this.#buildEvent(state, sequence, "conversation_updated", {
        invocationId,
        iteration: state.iteration,
        payload: { messageCount: state.messages.length },
      }),
    );
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    events.push(this.#buildCheckpointEvent(state, checkpoint, invocationId));
    await this.#appendAtomic(
      state,
      events,
      checkpoint,
      "tool exchange",
      invocationId,
    );
  }

  async #persistToolReconciliation(
    state: TurnState,
    result: ModelToolResult,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    const invocationId = state.activeInvocationId ?? "reconciliation";
    const checkpoint = this.#buildCheckpoint(state, sequence, false);
    const event = this.#buildEvent(
      state,
      sequence,
      "tool_result_reconciled",
      {
        invocationId,
        iteration: state.iteration,
        payload: { toolResult: result.save() },
      },
    );
    const checkpointEvent = this.#buildCheckpointEvent(
      state,
      checkpoint,
      invocationId,
    );
    await this.#appendAtomic(
      state,
      [event, checkpointEvent],
      checkpoint,
      "tool reconciliation",
      result.requestId,
    );
  }

  async #appendAtomic(
    state: TurnState,
    events: readonly EngineEvent[],
    checkpoint: EngineCheckpoint,
    stage: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.#effects.durability.appendWithCheckpoint(events, checkpoint);
    } catch (error) {
      throw new TurnEngineRecoveryRequiredError({
        stage,
        requestId,
        checkpoint,
        toolResults: [...state.toolResults],
        cause: error,
      });
    }
    state.sequence =
      events.length > 0
        ? events[events.length - 1].sequence
        : checkpoint.lastSequence;
  }

  #buildCheckpoint(
    state: TurnState,
    lastSequence: number,
    resumeSameIteration: boolean,
  ): EngineCheckpoint {
    return new EngineCheckpoint({
      id: this.#effects.ids.nextId("checkpoint"),
      sessionId: state.sessionId,
      turnId: state.turnId,
      runId: state.runId,
      parentRunId: state.parentRunId,
      delegationDepth: state.delegationDepth,
      iteration: state.iteration,
      lastSequence,
      messages: [...state.messages],
      stablePrefixMessages: state.stablePrefixMessages,
      inputs: state.inputs,
      activeInvocationId: state.activeInvocationId,
      pendingToolRequests: [...state.pendingToolRequests],
      completedToolResults: [...state.toolResults],
      completedModelIterations: state.completedModelIterations,
      reconciliationRequired:
        state.reconciliationRequired ||
        state.toolResults.at(-1)?.outcome === "indeterminate",
      modelReconciliation: state.modelReconciliation,
      pendingOutput: state.pendingOutput,
      finalOutputReady: state.finalOutputReady,
      pendingModelResponse: state.pendingModelResponse,
      resumeSameIteration,
      policyAppliedForIteration: state.policyAppliedForIteration,
      contextState: new InvocationContextState({
        portability: state.portability,
        delegatedState: [...state.delegatedState],
      }),
      metadata:
        state.committedToolResultIds.size === 0
          ? undefined
          : {
              committedToolResultIds: [...state.committedToolResultIds],
            },
    });
  }

  #buildCheckpointEvent(
    state: TurnState,
    checkpoint: EngineCheckpoint,
    invocationId: string,
  ): EngineEvent {
    return this.#buildEvent(
      state,
      checkpoint.lastSequence + 1,
      "checkpoint_created",
      {
        invocationId,
        iteration: checkpoint.iteration,
        payload: {
          checkpointId: checkpoint.id,
          includedThroughSequence: checkpoint.lastSequence,
        },
      },
    );
  }

  async #emitPermissionResolved(
    state: TurnState,
    invocationId: string,
    request: ModelToolRequest,
    decision: EnginePermissionDecision,
  ): Promise<void> {
    await this.#emit(state, "permission_resolved", {
      invocationId,
      iteration: state.iteration,
      payload: {
        toolRequestId: request.id,
        decision: decision.save(),
      },
    });
  }

  async #applyFinalPolicy(
    state: TurnState,
    cancellation: TurnCancellationToken,
  ): Promise<TurnEngineResult> {
    if (cancellation.isCancellationRequested) {
      return this.#commitCancellation(state, cancellation);
    }
    let result;
    try {
      result = await this.#effects.policy.beforeCommit(
        new FinalOutputPolicyRequest({
          sessionId: state.sessionId,
          turnId: state.turnId,
          iteration: state.iteration,
          messages: state.messages,
          output: state.output,
          inputs: state.inputs,
        }),
        cancellation,
      );
    } catch (error) {
      if (cancellation.isCancellationRequested) {
        return this.#commitCancellation(state, cancellation);
      }
      const policyError =
        error instanceof TurnHostPolicyError
          ? error
          : new TurnHostPolicyError("policy_error", errorMessage(error), {
              cause: error,
            });
      return this.#commitFailure(
        state,
        policyError.errorKind,
        policyError.message,
        cancellation,
      );
    }
    if (cancellation.isCancellationRequested) {
      return this.#commitCancellation(state, cancellation);
    }
    state.output = result.output;
    return this.#commit(state, "success", "turn_committed", cancellation);
  }

  #commitCancellation(
    state: TurnState,
    cancellation: TurnCancellationToken,
  ): Promise<TurnEngineResult> {
    return this.#commit(state, "cancelled", "turn_cancelled", cancellation);
  }

  #commitFailure(
    state: TurnState,
    errorKind: string,
    message: string,
    cancellation: TurnCancellationToken,
  ): Promise<TurnEngineResult> {
    state.output = { errorKind, message };
    return this.#commit(state, "failed", "turn_failed", cancellation);
  }

  #commitReconciliation(
    state: TurnState,
    errorKind: string,
    message: string,
    cancellation: TurnCancellationToken,
  ): Promise<TurnEngineResult> {
    state.output = { errorKind, message };
    return this.#commit(
      state,
      "reconciliation_required",
      "turn_reconciliation_required",
      cancellation,
    );
  }

  async #commit(
    state: TurnState,
    status: EngineTurnStatus,
    kind: EngineEventKind,
    cancellation: TurnCancellationToken,
  ): Promise<TurnEngineResult> {
    await this.#emit(state, kind, {
      iteration: state.iteration,
      payload: { status, output: state.output },
    });
    const commit = new TurnCommit({
      sessionId: state.sessionId,
      turnId: state.turnId,
      status,
      output: state.output,
      messages: [...state.messages],
      iterations: state.completedModelIterations,
      lastSequence: state.sequence,
      contextState: new InvocationContextState({
        portability: state.portability,
        delegatedState: [...state.delegatedState],
      }),
      modelReconciliation: state.modelReconciliation,
    });

    let postCommitError: string | undefined;
    if (status === "success") {
      const effectId = `post_commit:${commit.sessionId.length}:${commit.sessionId}:${commit.turnId.length}:${commit.turnId}`;
      try {
        await this.#emit(state, "post_commit_started", {
          iteration: state.iteration,
          payload: { effectId },
        });
      } catch (error) {
        postCommitError = `Post-commit effect '${effectId}' was not started because its start event could not be persisted: ${errorMessage(error)}`;
      }
      if (!postCommitError) {
        try {
          await this.#effects.postCommit.afterCommit(
            effectId,
            commit,
            cancellation,
          );
          try {
            await this.#emit(state, "post_commit_completed", {
              iteration: state.iteration,
              payload: { effectId },
            });
          } catch (error) {
            postCommitError = `Post-commit effect '${effectId}' completed, but its completion event could not be persisted: ${errorMessage(error)}`;
          }
        } catch (error) {
          const message = errorMessage(error);
          try {
            await this.#emit(state, "post_commit_failed", {
              iteration: state.iteration,
              payload: { effectId, message },
            });
            postCommitError = message;
          } catch (eventError) {
            postCommitError = `${message}; failure event for post-commit effect '${effectId}' could not be persisted: ${errorMessage(eventError)}`;
          }
        }
      }
    }
    commit.lastSequence = state.sequence;
    return new TurnEngineResult({
      commit,
      snapshots: state.snapshots,
      toolResults: state.toolResults,
      postCommitError,
    });
  }

  async #emit(
    state: TurnState,
    kind: EngineEventKind,
    options: EventOptions,
  ): Promise<void> {
    const sequence = state.sequence + 1;
    const event = this.#buildEvent(state, sequence, kind, options);
    try {
      await this.#effects.durability.append(event);
    } catch (error) {
      throw new TurnEnginePortError("event journal", error);
    }
    state.sequence = sequence;
  }

  #buildEvent(
    state: TurnState,
    sequence: number,
    kind: EngineEventKind,
    options: EventOptions,
  ): EngineEvent {
    return new EngineEvent({
      sequence,
      id: this.#effects.ids.nextId("event"),
      timestamp: this.#effects.clock.now(),
      sessionId: state.sessionId,
      turnId: state.turnId,
      runId: state.runId,
      parentRunId: state.parentRunId,
      delegationDepth: state.delegationDepth,
      invocationId: options.invocationId,
      iteration: options.iteration,
      kind,
      payload: options.payload,
    });
  }
}

interface EventOptions {
  invocationId?: string;
  iteration?: number;
  payload?: unknown;
}

interface ToolExecution {
  result: ModelToolResult;
  executed: boolean;
}

class TurnState {
  readonly sessionId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly delegationDepth: number;
  messages: Message[];
  readonly inputs?: unknown;
  readonly maxIterations: number;
  readonly maxModelAttempts: number;
  stablePrefixMessages: number;
  portability: InvocationContextState["portability"];
  delegatedState: DelegatedStateReference[];
  activeInvocationId?: string;
  pendingToolRequests: ModelToolRequest[];
  reconciliationRequired: boolean;
  modelReconciliation?: ModelReconciliationState;
  completedModelIterations: number;
  pendingOutput?: unknown;
  finalOutputReady: boolean;
  pendingModelResponse?: ModelInvocationResponse;
  policyAppliedForIteration: boolean;
  reconciliationResolution?: ModelToolResult;
  modelReconciliationResolution?: ModelInvocationResponse;
  iteration: number;
  sequence: number;
  output?: unknown;
  readonly snapshots: ModelInvocationContextSnapshot[] = [];
  readonly toolResults: ModelToolResult[];
  readonly committedToolResultIds: Set<string>;

  constructor(request: TurnEngineRequest) {
    this.sessionId = request.sessionId;
    this.turnId = request.turnId;
    this.runId = request.runId;
    this.parentRunId = request.parentRunId;
    this.delegationDepth = request.delegationDepth;
    this.messages = [...request.messages];
    this.inputs = request.inputs;
    this.maxIterations = request.maxIterations;
    this.maxModelAttempts = request.maxModelAttempts;
    this.stablePrefixMessages = request.stablePrefixMessages;
    this.portability = request.contextState.portability;
    this.delegatedState = [...(request.contextState.delegatedState ?? [])];
    this.activeInvocationId = request.activeInvocationId;
    this.pendingToolRequests = [...request.pendingToolRequests];
    this.reconciliationRequired = request.reconciliationRequired;
    this.modelReconciliation = request.modelReconciliation;
    this.completedModelIterations = request.completedModelIterations;
    this.pendingOutput = request.pendingOutput;
    this.finalOutputReady = request.finalOutputReady;
    this.pendingModelResponse = request.pendingModelResponse;
    this.policyAppliedForIteration = request.policyAppliedForIteration;
    this.reconciliationResolution = request.reconciliationResolution;
    this.modelReconciliationResolution =
      request.modelReconciliationResolution;
    this.iteration = request.startIteration;
    this.sequence = request.initialSequence;
    this.toolResults = [...request.completedToolResults];
    this.committedToolResultIds = new Set(request.committedToolResultIds);
  }

  applyModelResponse(
    invocationId: string,
    response: ModelInvocationResponse,
  ): void {
    this.completedModelIterations += 1;
    const requests = response.toolRequests ?? [];
    if (requests.length === 0) {
      this.messages.push(...(response.assistantMessages ?? []));
      this.pendingModelResponse = undefined;
    } else {
      this.pendingModelResponse = response;
    }
    this.applyProviderState(response);
    this.activeInvocationId = invocationId;
    this.pendingToolRequests = [...requests];
    this.pendingOutput = response.output;
    this.finalOutputReady = requests.length === 0;
  }

  private applyProviderState(response: ModelInvocationResponse): void {
    if (response.nextContextState) {
      this.portability = response.nextContextState.portability;
      this.delegatedState = [
        ...(response.nextContextState.delegatedState ?? []),
      ];
    } else if (this.portability === "portable") {
      this.delegatedState = [];
    }
    if (this.portability === "portable" && this.delegatedState.length > 0) {
      throw new Error(
        "Portable provider state cannot retain delegated references",
      );
    }
    if (this.portability === "delegated" && this.delegatedState.length === 0) {
      throw new Error(
        "Delegated provider state requires at least one reference",
      );
    }
  }
}

function cloneCheckpoint(checkpoint: EngineCheckpoint): EngineCheckpoint {
  return EngineCheckpoint.load(checkpoint.save());
}

function checkpointCommittedToolResultIds(
  checkpoint: EngineCheckpoint,
): string[] {
  const value = checkpoint.metadata?.["committedToolResultIds"];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function messagesEqual(left: readonly Message[], right: readonly Message[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (message, index) =>
      JSON.stringify(message.save()) === JSON.stringify(right[index].save()),
  );
}
