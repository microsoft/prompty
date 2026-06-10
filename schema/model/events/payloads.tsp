import "prompty-emitter";
import "../conversation/message.tsp";
import "../conversation/tool-invocation.tsp";
import "../model/usage.tsp";

namespace Prompty;

/**
 * The type of event emitted during agent loop execution. Events enable
 * real-time UIs, logging, and coordination without coupling the loop
 * to any particular output mechanism.
 */
alias TurnEventType =
  | "turn_start"
  | "turn_end"
  | "llm_start"
  | "llm_complete"
  | "retry"
  | "permission_requested"
  | "permission_completed"
  | "token"
  | "thinking"
  | "tool_call_start"
  | "tool_call_complete"
  | "tool_result"
  | "status"
  | "messages_updated"
  | "done"
  | "error"
  | "cancelled"
  | "compaction_start"
  | "compaction_complete"
  | "compaction_failed";

/**
 * Final semantic status for a turn.
 */
alias TurnStatus = "success" | "error" | "cancelled";

/**
 * A canonical event envelope emitted by the turn harness. The payload is kept
 * JSON-shaped so runtimes can load all events even when newer payload types are
 * added; event-specific typed payload models below define the canonical shapes.
 */
model TurnEvent {
  @doc("Unique identifier for this event")
  @sample(#{ id: "evt_abc123" })
  id: string;

  @doc("Event type discriminator")
  type: TurnEventType;

  @doc("ISO 8601 UTC timestamp when the event was emitted")
  @sample(#{ timestamp: "2026-06-09T20:00:00Z" })
  timestamp: string;

  @doc("Stable identifier for the outer turn")
  @sample(#{ turnId: "turn_001" })
  turnId?: string;

  @doc("Zero-based agent-loop iteration associated with the event")
  @sample(#{ iteration: 0 })
  iteration?: int32;

  @doc("Parent event or span identifier for reconstructing event hierarchy")
  @sample(#{ parentId: "evt_parent" })
  parentId?: string;

  @doc("Trace span identifier associated with this event")
  @sample(#{ spanId: "span_tool_001" })
  spanId?: string;

  @doc("Event-specific payload. Use the typed payload model matching 'type'.")
  payload: Record<unknown> = #{};
}

/**
 * Payload for "turn_start" events — a turn is beginning.
 */
model TurnStartPayload {
  @doc("Name of the loaded prompt/agent, when available")
  @sample(#{ agent: "weather-agent" })
  agent?: string;

  @doc("Input values supplied to the turn after host-side sanitization")
  inputs?: Record<unknown>;

  @doc("Configured maximum tool-call iterations")
  @sample(#{ maxIterations: 10 })
  maxIterations?: int32;
}

/**
 * Payload for "turn_end" events — a turn has completed.
 */
model TurnEndPayload {
  @doc("Number of tool-call iterations performed")
  @sample(#{ iterations: 2 })
  iterations?: int32;

  @doc("Final semantic status of the turn")
  status?: TurnStatus;

  @doc("Final response after processing, if available")
  response?: unknown;

  @doc("Total elapsed turn duration in milliseconds")
  @sample(#{ durationMs: 1500 })
  durationMs?: float64;
}

/**
 * Payload for "llm_start" events — an LLM request is about to be sent.
 */
model LlmStartPayload {
  @doc("Provider identifier used for the request")
  @sample(#{ provider: "openai" })
  provider?: string;

  @doc("Model or deployment identifier used for the request")
  @sample(#{ modelId: "gpt-4o-mini" })
  modelId?: string;

  @doc("Number of messages sent to the provider")
  @sample(#{ messageCount: 4 })
  messageCount?: int32;

  @doc("Retry attempt number, zero for the initial attempt")
  @sample(#{ attempt: 0 })
  attempt?: int32;
}

/**
 * Payload for "llm_complete" events — an LLM request completed.
 */
model LlmCompletePayload {
  @doc("Provider request identifier, when supplied by the SDK/API")
  @sample(#{ requestId: "req_abc123" })
  requestId?: string;

  @doc("Service request identifier, when supplied by the SDK/API")
  @sample(#{ serviceRequestId: "srv_abc123" })
  serviceRequestId?: string;

  @doc("Token usage reported by the provider")
  usage?: TokenUsage;

  @doc("LLM call duration in milliseconds")
  @sample(#{ durationMs: 820 })
  durationMs?: float64;
}

/**
 * Payload for "retry" events — a transient operation will be retried.
 */
model RetryPayload {
  @doc("Operation being retried")
  @sample(#{ operation: "llm" })
  operation: string;

  @doc("Attempt number about to run")
  @sample(#{ attempt: 2 })
  attempt: int32;

  @doc("Maximum configured attempts")
  @sample(#{ maxAttempts: 3 })
  maxAttempts?: int32;

  @doc("Backoff delay before the next attempt in milliseconds")
  @sample(#{ delayMs: 1250 })
  delayMs?: float64;

  @doc("Reason for the retry")
  @sample(#{ reason: "rate_limit" })
  reason?: string;
}

/**
 * Payload for permission request events — a host is asked to approve an action.
 */
model PermissionRequestedPayload {
  @doc("Permission/action name being requested")
  @sample(#{ permission: "tool.execute" })
  permission: string;

  @doc("Resource or tool the permission applies to")
  @sample(#{ target: "shell" })
  target?: string;

  @doc("Additional host-specific permission details")
  details?: Record<unknown>;
}

/**
 * Payload for permission completion events — an approval decision was made.
 */
model PermissionCompletedPayload {
  @doc("Permission/action name that was decided")
  @sample(#{ permission: "tool.execute" })
  permission: string;

  @doc("Whether the requested permission was approved")
  @sample(#{ approved: true })
  approved: boolean;

  @doc("Decision reason, if available")
  @sample(#{ reason: "user_approved" })
  reason?: string;
}

/**
 * Payload for "token" events — a single text token streamed from the LLM.
 */
model TokenEventPayload {
  @doc("The streamed token text")
  @sample(#{ token: "Hello" })
  token: string;
}

/**
 * Payload for "thinking" events — reasoning/chain-of-thought tokens.
 */
model ThinkingEventPayload {
  @doc("The thinking/reasoning token text")
  @sample(#{ token: "Let me consider..." })
  token: string;
}

/**
 * Payload for "tool_call_start" events — the LLM has requested a tool call.
 */
model ToolCallStartPayload {
  @doc("The unique identifier of the tool call")
  @sample(#{ id: "call_abc123" })
  id?: string;

  @doc("The name of the tool being called")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The serialized JSON arguments for the tool call")
  @sample(#{ arguments: "{\"city\": \"Paris\"}" })
  arguments: string;
}

/**
 * Payload for "tool_call_complete" events — a tool dispatch finished.
 */
model ToolCallCompletePayload {
  @doc("The unique identifier of the tool call")
  @sample(#{ id: "call_abc123" })
  id?: string;

  @doc("The name of the tool that completed")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("Whether the tool dispatch succeeded semantically")
  @sample(#{ success: true })
  success: boolean;

  @doc("Normalized tool result")
  result?: ToolResult;

  @doc("Tool execution duration in milliseconds")
  @sample(#{ durationMs: 42 })
  durationMs?: float64;

  @doc("Machine-readable error category when success is false")
  @sample(#{ errorKind: "timeout" })
  errorKind?: string;
}

/**
 * Payload for "tool_result" events — a tool has returned its result.
 */
model ToolResultPayload {
  @doc("The name of the tool that produced the result")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The tool's result")
  @sample(#{
    result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
  })
  result: ToolResult;
}

/**
 * Payload for "status" events — informational messages about loop progress.
 */
model StatusEventPayload {
  @doc("Human-readable status message")
  @sample(#{ message: "Starting iteration 3" })
  message: string;
}

/**
 * Payload for "messages_updated" events — the conversation state has changed.
 */
model MessagesUpdatedPayload {
  @doc("The current full message list after the update")
  messages?: Message[];

  @doc("Why the message list changed")
  @sample(#{ reason: "tool_results" })
  reason?: string;

  @doc("Messages appended by this update, when available")
  appended?: Message[];

  @doc("Number of messages removed by this update, when available")
  @sample(#{ removed: 2 })
  removed?: int32;
}

/**
 * Payload for "done" events — the agent loop completed successfully.
 */
model DoneEventPayload {
  @doc("The final response from the LLM after processing")
  response: unknown;

  @doc("The final conversation state including all messages")
  messages: Message[];
}

/**
 * Payload for "error" events — an error occurred during the loop.
 */
model ErrorEventPayload {
  @doc("Human-readable error description")
  @sample(#{ message: "Rate limit exceeded" })
  message: string;

  @doc("Stable machine-readable error category")
  @sample(#{ errorKind: "rate_limit" })
  errorKind?: string;

  @doc("Operation or phase where the error occurred")
  @sample(#{ phase: "llm" })
  phase?: string;
}

/**
 * Payload for "compaction_start" events — context compaction is beginning.
 */
model CompactionStartPayload {
  @doc("Number of messages selected for compaction")
  @sample(#{ droppedCount: 5 })
  droppedCount: int32;
}

/**
 * Payload for "compaction_complete" events — context compaction finished.
 */
model CompactionCompletePayload {
  @doc("Number of messages removed during compaction")
  @sample(#{ removed: 5 })
  removed: int32;

  @doc("Number of messages remaining after compaction")
  @sample(#{ remaining: 3 })
  remaining: int32;

  @doc("Length of the generated summary, when a summarization strategy is used")
  @sample(#{ summaryLength: 1200 })
  summaryLength?: int32;
}

/**
 * Payload for "compaction_failed" events — compaction could not be completed.
 */
model CompactionFailedPayload {
  @doc("Explanation of why compaction failed")
  @sample(#{ message: "Summarization prompt exceeded context window" })
  message: string;
}

/**
 * Summary statistics for a completed turn trace.
 */
model TurnSummary {
  @doc("Stable identifier for the outer turn")
  @sample(#{ turnId: "turn_001" })
  turnId: string;

  @doc("Final turn status: 'success', 'error', or 'cancelled'")
  @sample(#{ status: "success" })
  status: string;

  @doc("Number of agent-loop iterations")
  @sample(#{ iterations: 2 })
  iterations: int32;

  @doc("Number of LLM calls made during the turn")
  @sample(#{ llmCalls: 3 })
  llmCalls?: int32;

  @doc("Number of tool calls dispatched during the turn")
  @sample(#{ toolCalls: 2 })
  toolCalls?: int32;

  @doc("Number of retry events during the turn")
  @sample(#{ retries: 1 })
  retries?: int32;

  @doc("Aggregated token usage for the turn")
  usage?: TokenUsage;

  @doc("Total elapsed turn duration in milliseconds")
  @sample(#{ durationMs: 2500 })
  durationMs?: float64;
}

/**
 * Portable JSONL/replay container for a recorded turn harness run.
 */
model TurnTrace {
  @doc("Trace schema version")
  @sample(#{ version: "1" })
  version: string = "1";

  @doc("Runtime name that produced the trace")
  @sample(#{ runtime: "typescript" })
  runtime?: string;

  @doc("Prompty library version that produced the trace")
  @sample(#{ promptyVersion: "2.0.0" })
  promptyVersion?: string;

  @doc("Recorded turn events in emission order")
  events: TurnEvent[];

  @doc("Optional summary computed from the event stream")
  summary?: TurnSummary;
}
