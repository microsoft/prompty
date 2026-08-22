// Copyright (c) Microsoft. All rights reserved.

/**
 * Provider-agnostic single-turn engine — the `TurnConformance.runTurn` engine.
 *
 * This module owns the *snapshot and portability* turn contract asserted by
 * `schema/model/conformance/vectors/turn.tsp` (stage `turn`). Like the agent
 * loop, it is provider-agnostic: the turn is driven by an abstract
 * `invokeModel` callback plus optional `resolvePermission` / `executeTool`
 * callbacks, so every provider shares one engine and supplies only wire
 * translation.
 *
 * Where the agent loop models the *conversational* loop (message accounting,
 * guardrails, steering), this engine models the *durable* turn: per-iteration
 * snapshots, a stable-prefix marker, portability transitions (`portable` vs
 * `delegated` provider state), and a fixed lifecycle event vocabulary. Direct
 * port of the verified Python reference `prompty.core.turn_engine`.
 */

export const DEFAULT_MAX_ITERATIONS = 10;
export const PORTABILITY_PORTABLE = "portable";
export const PORTABILITY_DELEGATED = "delegated";

/** A tool invocation requested by the model. */
export interface TurnToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A normalized single model turn. */
export interface TurnModelTurn {
  output?: unknown;
  toolCalls?: TurnToolCall[];
  nextPortability?: string | null;
  delegatedState?: unknown[] | null;
}

/** The outcome of one tool invocation within a turn. */
export interface TurnToolResult {
  id: string;
  result: unknown;
  success: boolean;
}

/** The observable result of a single turn. */
export interface TurnResult {
  status: string;
  output: unknown;
  iterations: number;
  snapshots: number;
  snapshotStablePrefixes: number[];
  snapshotPortability: string[];
  commitPortability: string;
  delegatedStateCount: number;
  toolResults: TurnToolResult[];
  toolResultOrder: string[];
  events: string[];
}

export type TurnInvokeModel = (
  iteration: number,
  toolResults: TurnToolResult[],
) => TurnModelTurn | Promise<TurnModelTurn>;
export type ResolvePermission = (
  call: TurnToolCall,
) => boolean | Promise<boolean>;
export type ExecuteTool = (call: TurnToolCall) => unknown | Promise<unknown>;

export interface RunTurnEngineOptions {
  invokeModel: TurnInvokeModel;
  resolvePermission?: ResolvePermission | null;
  executeTool?: ExecuteTool | null;
  cancelBeforeRun?: boolean;
  maxIterations?: number;
}

/**
 * Run one turn and return its snapshot/portability observable result.
 *
 * The turn is deterministic: given the same callbacks and inputs it always
 * produces the same snapshots, portability transitions, tool ordering, and
 * lifecycle events.
 */
export async function runTurnEngine(
  messages: Record<string, unknown>[],
  options: RunTurnEngineOptions,
): Promise<TurnResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const result: TurnResult = {
    status: "success",
    output: null,
    iterations: 0,
    snapshots: 0,
    snapshotStablePrefixes: [],
    snapshotPortability: [],
    commitPortability: PORTABILITY_PORTABLE,
    delegatedStateCount: 0,
    toolResults: [],
    toolResultOrder: [],
    events: [],
  };

  const emit = (kind: string): void => {
    result.events.push(kind);
  };

  emit("turn_started");

  if (options.cancelBeforeRun) {
    emit("turn_cancelled");
    result.status = "cancelled";
    result.output = null;
    return result;
  }

  const stablePrefix = messages.length;
  let pendingPortability = PORTABILITY_PORTABLE;
  let delegatedState: unknown[] = [];
  let pendingToolResults: TurnToolResult[] = [];
  const approve = options.resolvePermission ?? (() => true);
  const dispatch = options.executeTool ?? (() => null);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    result.iterations = iteration + 1;

    emit("context_prepared");
    emit("model_invocation_started");
    const turn = await options.invokeModel(iteration, pendingToolResults);
    emit("model_invocation_completed");

    result.snapshotPortability.push(pendingPortability);
    result.snapshotStablePrefixes.push(stablePrefix);
    result.snapshots += 1;
    emit("checkpoint_created");

    if (turn.nextPortability === PORTABILITY_DELEGATED) {
      pendingPortability = PORTABILITY_DELEGATED;
      delegatedState = turn.delegatedState ?? [];
    }

    const toolCalls = turn.toolCalls ?? [];
    if (toolCalls.length === 0) {
      result.output = turn.output ?? null;
      result.commitPortability = pendingPortability;
      result.delegatedStateCount = delegatedState.length;
      emit("turn_committed");
      emit("post_commit_started");
      emit("post_commit_completed");
      return result;
    }

    pendingToolResults = [];
    for (const call of toolCalls) {
      emit("permission_requested");
      const approved = await approve(call);
      emit("permission_resolved");
      let toolResult: TurnToolResult;
      if (approved) {
        emit("tool_execution_started");
        const output = await dispatch(call);
        emit("tool_execution_completed");
        toolResult = { id: call.id, result: output, success: true };
      } else {
        toolResult = {
          id: call.id,
          result: {
            message: "Permission denied",
            error_kind: "permission_denied",
          },
          success: false,
        };
      }
      emit("checkpoint_created");
      result.toolResults.push(toolResult);
      result.toolResultOrder.push(call.id);
      pendingToolResults.push(toolResult);
    }

    for (let i = 0; i < toolCalls.length; i += 1) {
      emit("tool_result_committed");
    }
    emit("conversation_updated");
    emit("checkpoint_created");
  }

  result.status = "error";
  result.commitPortability = pendingPortability;
  result.delegatedStateCount = delegatedState.length;
  return result;
}
