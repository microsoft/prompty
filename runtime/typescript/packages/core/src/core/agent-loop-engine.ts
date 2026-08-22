// Copyright (c) Microsoft. All rights reserved.

/**
 * Provider-agnostic agent loop — the canonical `TurnConformance.run` engine.
 *
 * This module owns the *observable* agent-loop contract asserted by the
 * cross-runtime `@vector` suite (`schema/model/conformance/vectors/agent.tsp`,
 * stage `agent`). It is deliberately provider-agnostic: the loop is driven by
 * two abstract callbacks — `invokeModel(conversation)` (one LLM call) and
 * `dispatchTool(call)` (one tool execution) — so the same engine backs every
 * provider. Providers supply only the wire translation that turns their raw
 * response into a {@link ModelResponse}; they never re-implement the loop, its
 * accounting, or its event vocabulary.
 *
 * This is a direct port of the verified Python reference
 * `prompty.core.agent_loop`; the accounting conventions (iterations count LLM
 * calls, `totalMessages` adds one when any tool round ran, the fixed event
 * order and canonical message shapes) are native to this engine and never
 * recomputed by an adapter.
 */

export const DEFAULT_MAX_ITERATIONS = 10;
export const SUMMARY_PREFIX = "[Summary of earlier conversation] ";

const CANCELLED_ERROR = "CancelledError";
const GUARDRAIL_ERROR = "GuardrailError";

type JsonRecord = Record<string, unknown>;

/** A single tool invocation requested by the model. */
export interface AgentToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model emitted it. */
  arguments: string;
}

/** A normalized single-turn model response. */
export interface ModelResponse {
  content?: string | null;
  toolCalls?: AgentToolCall[];
  /** The provider's exact tool-call array, round-tripped byte-for-byte. */
  rawToolCalls?: JsonRecord[] | null;
}

/** Outcome of a guardrail check. */
export interface GuardrailDecision {
  allowed: boolean;
  reason?: string | null;
}

/** A steering message scheduled for injection before a given iteration. */
export interface SteeringMessage {
  injectBeforeIteration: number;
  role: string;
  text: string;
}

/** The observable result of an agent-loop run. */
export interface AgentLoopResult {
  result: string | null;
  iterations: number;
  conversation: JsonRecord[];
  events: Array<{ type: string; data: JsonRecord }>;
  toolRounds: number;
  toolsExecuted: number;
  toolExecutionOrder: string[];
  deniedTools: string[];
  trimmedMessages: JsonRecord[] | null;
  error: string | null;
  errorType: string | null;
  errorReason: string | null;
}

/** Conversation length plus the conformance `+1` when tools ran. */
export function totalMessages(result: AgentLoopResult): number {
  return result.conversation.length + (result.toolRounds > 0 ? 1 : 0);
}

export type InvokeModel = (
  conversation: JsonRecord[],
) => ModelResponse | Promise<ModelResponse>;
export type DispatchTool = (call: AgentToolCall) => string | Promise<string>;
export type IsToolRegistered = (name: string) => boolean;
export type InputGuardrailFn = (
  conversation: JsonRecord[],
) => GuardrailDecision;
export type OutputGuardrailFn = (response: ModelResponse) => GuardrailDecision;
export type ToolGuardrailFn = (
  name: string,
  args: JsonRecord,
) => GuardrailDecision;
export type Summarize = (dropped: JsonRecord[]) => string;

export interface RunAgentLoopOptions {
  invokeModel: InvokeModel;
  dispatchTool: DispatchTool;
  isToolRegistered?: IsToolRegistered;
  maxIterations?: number;
  inputGuardrail?: InputGuardrailFn | null;
  outputGuardrail?: OutputGuardrailFn | null;
  toolGuardrail?: ToolGuardrailFn | null;
  steering?: SteeringMessage[];
  cancelAt?: string | null;
  contextBudget?: number | null;
  summarize?: Summarize | null;
}

function assistantToolCallsMessage(response: ModelResponse): JsonRecord {
  const toolCalls =
    response.rawToolCalls != null
      ? response.rawToolCalls
      : (response.toolCalls ?? []).map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
  return {
    role: "assistant",
    content: "",
    metadata: { tool_calls: toolCalls },
  };
}

function toolMessage(callId: string, content: string): JsonRecord {
  return { role: "tool", content, metadata: { tool_call_id: callId } };
}

function charCount(messages: JsonRecord[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") total += m.content.length;
  }
  return total;
}

function parseArgs(args: string): JsonRecord {
  try {
    const parsed = args ? JSON.parse(args) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function defaultSummary(droppedUsers: JsonRecord[]): string {
  const topics = droppedUsers
    .filter((m) => m.content)
    .map((m) => String(m.content ?? "").trim());
  return SUMMARY_PREFIX + "User asked about " + topics.join("; ");
}

function maybeTrim(
  conversation: JsonRecord[],
  contextBudget: number | null | undefined,
  summarize: Summarize | null | undefined,
): JsonRecord[] | null {
  if (contextBudget == null || charCount(conversation) <= contextBudget) {
    return null;
  }
  const systems = conversation
    .filter((m) => m.role === "system")
    .map((m) => ({ ...m }));
  const users = conversation.filter((m) => m.role === "user");
  const droppedUsers = users.slice(0, -1);
  const lastUser = users.length > 0 ? users[users.length - 1] : null;

  const summaryText =
    summarize != null ? summarize(droppedUsers) : defaultSummary(droppedUsers);
  const trimmed: JsonRecord[] = [
    ...systems,
    { role: "system", content: summaryText },
  ];
  if (lastUser != null) {
    trimmed.push({ role: "user", content: lastUser.content });
  }
  return trimmed;
}

/**
 * Run the canonical agent loop and return its observable result.
 *
 * `cancelAt` accepts the scripted positions `"before_iteration"` (before
 * iteration 1), `"before_iteration_<n>"` (before iteration *n*), and
 * `"after_tool_<i>"` (after the *i*-th tool of a round). The loop is
 * deterministic: given the same callbacks and flags it always produces the
 * same events and accounting.
 */
export async function runAgentLoop(
  messages: JsonRecord[],
  options: RunAgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const result: AgentLoopResult = {
    result: null,
    iterations: 0,
    conversation: [],
    events: [],
    toolRounds: 0,
    toolsExecuted: 0,
    toolExecutionOrder: [],
    deniedTools: [],
    trimmedMessages: null,
    error: null,
    errorType: null,
    errorReason: null,
  };
  let conversation: JsonRecord[] = messages.map((m) => ({ ...m }));

  const emit = (type: string, data: JsonRecord): void => {
    result.events.push({ type, data });
  };

  emit("status", { message: "Starting agent loop" });

  const trimmed = maybeTrim(
    conversation,
    options.contextBudget,
    options.summarize,
  );
  if (trimmed != null) {
    conversation = trimmed;
    result.trimmedMessages = trimmed.map((m) => ({ ...m }));
  }

  const steeringPending = [...(options.steering ?? [])];
  const registered = options.isToolRegistered ?? (() => true);

  for (;;) {
    const iterationNumber = result.iterations + 1;

    if (options.cancelAt === "before_iteration" && iterationNumber === 1) {
      emit("cancelled", {
        reason: "Cancellation requested before first iteration",
      });
      result.error = CANCELLED_ERROR;
      result.conversation = conversation;
      return result;
    }
    if (options.cancelAt === `before_iteration_${iterationNumber}`) {
      emit("cancelled", {
        reason: `Cancellation requested before iteration ${iterationNumber}`,
      });
      result.error = CANCELLED_ERROR;
      result.conversation = conversation;
      return result;
    }

    const toInject = steeringPending.filter(
      (s) => s.injectBeforeIteration === iterationNumber,
    );
    if (toInject.length > 0) {
      for (const s of toInject) {
        steeringPending.splice(steeringPending.indexOf(s), 1);
      }
      emit("status", { message: "Injecting steering message" });
      for (const s of toInject) {
        conversation.push({ role: s.role, content: s.text });
      }
      emit("messages_updated", { message_count: conversation.length + 1 });
    }

    if (options.inputGuardrail != null) {
      const decision = options.inputGuardrail(conversation);
      if (!decision.allowed) {
        result.error = GUARDRAIL_ERROR;
        result.errorReason = decision.reason ?? null;
        result.conversation = conversation;
        return result;
      }
    }

    const response = await options.invokeModel(conversation);
    result.iterations += 1;

    if (options.outputGuardrail != null) {
      const decision = options.outputGuardrail(response);
      if (!decision.allowed) {
        result.error = GUARDRAIL_ERROR;
        result.errorReason = decision.reason ?? null;
        result.conversation = conversation;
        return result;
      }
    }

    const toolCalls = response.toolCalls ?? [];
    if (toolCalls.length > 0) {
      conversation.push(assistantToolCallsMessage(response));
      result.toolRounds += 1;
      let cancelled = false;

      for (let idx = 0; idx < toolCalls.length; idx += 1) {
        const call = toolCalls[idx];
        emit("tool_call_start", { name: call.name, arguments: call.arguments });

        if (options.toolGuardrail != null) {
          const decision = options.toolGuardrail(
            call.name,
            parseArgs(call.arguments),
          );
          if (!decision.allowed) {
            result.deniedTools.push(call.name);
            conversation.push(
              toolMessage(
                call.id,
                `Tool denied by guardrail: ${decision.reason}`,
              ),
            );
            continue;
          }
        }

        if (!registered(call.name)) {
          result.error = `Tool not registered: ${call.name}`;
          result.errorType = "ValueError";
          result.conversation = conversation;
          return result;
        }

        const output = await options.dispatchTool(call);
        result.toolsExecuted += 1;
        result.toolExecutionOrder.push(call.name);
        emit("tool_result", { name: call.name, result: output });
        conversation.push(toolMessage(call.id, output));

        if (options.cancelAt === `after_tool_${idx}`) {
          emit("cancelled", {
            reason: "Cancellation requested after tool execution",
          });
          result.error = CANCELLED_ERROR;
          cancelled = true;
          break;
        }
      }

      if (cancelled) {
        result.conversation = conversation;
        return result;
      }

      emit("messages_updated", { message_count: conversation.length + 1 });

      if (result.iterations > maxIterations) {
        result.error = `Agent loop exceeded ${maxIterations} iterations`;
        result.conversation = conversation;
        return result;
      }

      continue;
    }

    result.result = response.content ?? null;
    conversation.push({ role: "assistant", content: response.content ?? null });
    emit("done", { response: response.content ?? null });
    result.conversation = conversation;
    return result;
  }
}
