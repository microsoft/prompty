import "@typra/emitter";
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
  | "tool_execution_start"
  | "tool_execution_complete"
  | "tool_result"
  | "hook_start"
  | "hook_end"
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
 * Scope where a host lifecycle hook is starting.
 */
alias HookStartScope = "turn" | "session";

/**
 * Scope where a host lifecycle hook finished.
 *
 * This intentionally mirrors HookStartScope but remains distinct because some
 * language generators emit enum aliases in each model file.
 */
alias HookEndScope = "turn" | "session";

/**
 * A canonical event envelope emitted by the turn harness. The payload is kept
 * JSON-shaped so runtimes can load all events even when newer payload types are
 * added; event-specific typed payload models below define the canonical shapes.
 */
model TurnEvent {
  @doc("Unique identifier for this event")
  @sample(fileIdSample)
  id: string;

  @doc("Event type discriminator")
  type: TurnEventType;

  @doc("ISO 8601 UTC timestamp when the event was emitted")
  @sample(fileTimestampSample)
  timestamp: string;

  @doc("Stable identifier for the outer turn")
  @sample(fileTurnIdSample)
  turnId?: string;

  @doc("Zero-based agent-loop iteration associated with the event")
  @sample(fileIterationSample)
  iteration?: int32;

  @doc("Parent event or span identifier for reconstructing event hierarchy")
  @sample(fileParentIdSample)
  parentId?: string;

  @doc("Trace span identifier associated with this event")
  @sample(fileSpanIdSample)
  spanId?: string;

  @doc("Event-specific payload. Use the typed payload model matching 'type'.")
  payload: Record<unknown>;
}

/**
 * Payload for "turn_start" events — a turn is beginning.
 */
model TurnStartPayload {
  @doc("Name of the loaded prompt/agent, when available")
  @sample(TurnStartPayloadAgentSample)
  agent?: string;

  @doc("Input values supplied to the turn after host-side sanitization")
  inputs?: Record<unknown>;

  @doc("Configured maximum tool-call iterations")
  @sample(TurnStartPayloadMaxIterationsSample)
  maxIterations?: int32;
}

/**
 * Payload for "turn_end" events — a turn has completed.
 */
model TurnEndPayload {
  @doc("Number of tool-call iterations performed")
  @sample(TurnEndPayloadIterationsSample)
  iterations?: int32;

  @doc("Final semantic status of the turn")
  status?: TurnStatus;

  @doc("Final response after processing, if available")
  response?: unknown;

  @doc("Total elapsed turn duration in milliseconds")
  @sample(TurnEndPayloadDurationMsSample)
  durationMs?: float64;
}

/**
 * Payload for "llm_start" events — an LLM request is about to be sent.
 */
model LlmStartPayload {
  @doc("Provider identifier used for the request")
  @sample(LlmStartPayloadProviderSample)
  provider?: string;

  @doc("Model or deployment identifier used for the request")
  @sample(LlmStartPayloadModelIdSample)
  modelId?: string;

  @doc("Number of messages sent to the provider")
  @sample(LlmStartPayloadMessageCountSample)
  messageCount?: int32;

  @doc("Retry attempt number, zero for the initial attempt")
  @sample(LlmStartPayloadAttemptSample)
  attempt?: int32;
}

/**
 * Payload for "llm_complete" events — an LLM request completed.
 */
model LlmCompletePayload {
  @doc("Provider request identifier, when supplied by the SDK/API")
  @sample(LlmCompletePayloadRequestIdSample)
  requestId?: string;

  @doc("Service request identifier, when supplied by the SDK/API")
  @sample(LlmCompletePayloadServiceRequestIdSample)
  serviceRequestId?: string;

  @doc("Token usage reported by the provider")
  usage?: TokenUsage;

  @doc("LLM call duration in milliseconds")
  @sample(LlmCompletePayloadDurationMsSample)
  durationMs?: float64;
}

/**
 * Payload for "retry" events — a transient operation will be retried.
 */
model RetryPayload {
  @doc("Operation being retried")
  @sample(RetryPayloadOperationSample)
  operation: string;

  @doc("Attempt number about to run")
  @sample(RetryPayloadAttemptSample)
  attempt: int32;

  @doc("Maximum configured attempts")
  @sample(RetryPayloadMaxAttemptsSample)
  maxAttempts?: int32;

  @doc("Backoff delay before the next attempt in milliseconds")
  @sample(RetryPayloadDelayMsSample)
  delayMs?: float64;

  @doc("Reason for the retry")
  @sample(RetryPayloadReasonSample)
  reason?: string;
}

/**
 * Payload for permission request events — a host is asked to approve an action.
 */
model PermissionRequestedPayload {
  @doc("Stable permission request identifier")
  @sample(PermissionRequestedPayloadRequestIdSample)
  requestId?: string;

  @doc("Associated tool call identifier, when the permission gates a tool call")
  @sample(PermissionRequestedPayloadToolCallIdSample)
  toolCallId?: string;

  @doc("Permission/action name being requested")
  @sample(PermissionRequestedPayloadPermissionSample)
  permission: string;

  @doc("Resource or tool the permission applies to")
  @sample(PermissionRequestedPayloadTargetSample)
  target?: string;

  @doc("Additional host-specific permission details")
  details?: Record<unknown>;

  @doc("Human-readable prompt or rationale that can be shown to an approval UI")
  @sample(PermissionRequestedPayloadPromptRequestSample)
  promptRequest?: string;

  @doc("Policy metadata used to evaluate or explain the permission request")
  policy?: Record<unknown>;

  @doc("Redaction state for sensitive request fields")
  redaction?: RedactionMetadata;
}

/**
 * Payload for permission completion events — an approval decision was made.
 */
model PermissionCompletedPayload {
  @doc("Stable permission request identifier")
  @sample(PermissionCompletedPayloadRequestIdSample)
  requestId?: string;

  @doc("Associated tool call identifier, when the permission gated a tool call")
  @sample(PermissionCompletedPayloadToolCallIdSample)
  toolCallId?: string;

  @doc("Permission/action name that was decided")
  @sample(PermissionCompletedPayloadPermissionSample)
  permission: string;

  @doc("Whether the requested permission was approved")
  @sample(PermissionCompletedPayloadApprovedSample)
  approved: boolean;

  @doc("Decision reason, if available")
  @sample(PermissionCompletedPayloadReasonSample)
  reason?: string;

  @doc("Host-specific decision result, such as a durable approval token or denial details")
  result?: Record<unknown>;

  @doc("Redaction state for sensitive decision fields")
  redaction?: RedactionMetadata;
}

/**
 * Request passed to a permission resolver. This is the live protocol shape; the
 * event payloads above can include trace-only metadata such as redaction state.
 */
model PermissionRequest {
  @doc("Stable permission request identifier")
  @sample(PermissionRequestRequestIdSample)
  requestId?: string;

  @doc("Associated tool call identifier, when the permission gates a tool call")
  @sample(PermissionRequestToolCallIdSample)
  toolCallId?: string;

  @doc("Permission/action name being requested")
  @sample(PermissionRequestPermissionSample)
  permission: string;

  @doc("Resource or tool the permission applies to")
  @sample(PermissionRequestTargetSample)
  target?: string;

  @doc("Additional host-specific permission details")
  details?: Record<unknown>;

  @doc("Human-readable prompt or rationale that can be shown to an approval UI")
  @sample(PermissionRequestPromptRequestSample)
  promptRequest?: string;

  @doc("Policy metadata used to evaluate or explain the permission request")
  policy?: Record<unknown>;
}

/**
 * Decision returned by a permission resolver.
 */
model PermissionDecision {
  @doc("Stable permission request identifier")
  @sample(PermissionDecisionRequestIdSample)
  requestId?: string;

  @doc("Associated tool call identifier, when the permission gated a tool call")
  @sample(PermissionDecisionToolCallIdSample)
  toolCallId?: string;

  @doc("Permission/action name that was decided")
  @sample(PermissionDecisionPermissionSample)
  permission: string;

  @doc("Whether the requested permission was approved")
  @sample(PermissionDecisionApprovedSample)
  approved: boolean;

  @doc("Decision reason, if available")
  @sample(PermissionDecisionReasonSample)
  reason?: string;

  @doc("Host-specific decision result, such as a durable approval token or denial details")
  result?: Record<unknown>;
}

/**
 * Payload for "token" events — a single text token streamed from the LLM.
 */
model TokenEventPayload {
  @doc("The streamed token text")
  @sample(TokenEventPayloadTokenSample)
  token: string;
}

/**
 * Payload for "thinking" events — reasoning/chain-of-thought tokens.
 */
model ThinkingEventPayload {
  @doc("The thinking/reasoning token text")
  @sample(ThinkingEventPayloadTokenSample)
  token: string;
}

/**
 * Payload for "tool_call_start" events — the LLM has requested a tool call.
 */
model ToolCallStartPayload {
  @doc("The unique identifier of the tool call")
  @sample(ToolCallStartPayloadIdSample)
  id?: string;

  @doc("The name of the tool being called")
  @sample(ToolCallStartPayloadNameSample)
  name: string;

  @doc("The serialized JSON arguments for the tool call")
  @sample(ToolCallStartPayloadArgumentsSample)
  arguments: string;
}

/**
 * Payload for "tool_call_complete" events — a tool dispatch finished.
 */
model ToolCallCompletePayload {
  @doc("The unique identifier of the tool call")
  @sample(ToolCallCompletePayloadIdSample)
  id?: string;

  @doc("The name of the tool that completed")
  @sample(ToolCallCompletePayloadNameSample)
  name: string;

  @doc("Whether the tool dispatch succeeded semantically")
  @sample(ToolCallCompletePayloadSuccessSample)
  success: boolean;

  @doc("Normalized tool result")
  result?: ToolResult;

  @doc("Tool execution duration in milliseconds")
  @sample(ToolCallCompletePayloadDurationMsSample)
  durationMs?: float64;

  @doc("Machine-readable error category when success is false")
  @sample(ToolCallCompletePayloadErrorKindSample)
  errorKind?: string;
}

/**
 * Payload for "tool_execution_start" events — the host is about to execute a concrete tool request.
 *
 * This is distinct from "tool_call_start", which records the model requesting a tool.
 * Tool execution events capture the harness-side action after policy and permission checks.
 */
model ToolExecutionStartPayload {
  @doc("Stable host execution request identifier")
  @sample(requestingRequestIdSample)
  requestId?: string;

  @doc("Associated model tool call identifier, when available")
  @sample(requestingToolCallIdSample)
  toolCallId?: string;

  @doc("Name of the host tool being executed")
  @sample(requestingToolNameSample)
  toolName: string;

  @doc("Tool arguments after host-side sanitization")
  arguments?: Record<unknown>;

  @doc("Working directory or execution scope for the tool")
  @sample(requestingWorkingDirectorySample)
  workingDirectory?: string;

  @doc("Redaction state for sensitive argument fields")
  redaction?: RedactionMetadata;
}

/**
 * Payload for "tool_execution_complete" events — a concrete host tool execution finished.
 */
model ToolExecutionCompletePayload {
  @doc("Stable host execution request identifier")
  @sample(ToolExecutionCompletePayloadRequestIdSample)
  requestId?: string;

  @doc("Associated model tool call identifier, when available")
  @sample(ToolExecutionCompletePayloadToolCallIdSample)
  toolCallId?: string;

  @doc("Name of the host tool that executed")
  @sample(ToolExecutionCompletePayloadToolNameSample)
  toolName: string;

  @doc("Whether the host execution completed successfully")
  @sample(ToolExecutionCompletePayloadSuccessSample)
  success: boolean;

  @doc("Host-normalized execution result")
  result?: unknown;

  @doc("Process or host exit code, when applicable")
  @sample(ToolExecutionCompletePayloadExitCodeSample)
  exitCode?: int32;

  @doc("Tool execution duration in milliseconds")
  @sample(ToolExecutionCompletePayloadDurationMsSample)
  durationMs?: float64;

  @doc("Machine-readable error category when success is false")
  @sample(ToolExecutionCompletePayloadErrorKindSample)
  errorKind?: string;

  @doc("Host-specific telemetry for the execution")
  telemetry?: Record<unknown>;

  @doc("Redaction state for sensitive result fields")
  redaction?: RedactionMetadata;
}

/**
 * Request passed to a host tool executor after policy and permission checks.
 */
model HostToolRequest {
  @doc("Stable host execution request identifier")
  @sample(HostToolRequestRequestIdSample)
  requestId?: string;

  @doc("Associated model tool call identifier, when available")
  @sample(HostToolRequestToolCallIdSample)
  toolCallId?: string;

  @doc("Name of the host tool being executed")
  @sample(HostToolRequestToolNameSample)
  toolName: string;

  @doc("Tool arguments after host-side sanitization")
  arguments?: Record<unknown>;

  @doc("Working directory or execution scope for the tool")
  @sample(HostToolRequestWorkingDirectorySample)
  workingDirectory?: string;
}

/**
 * Result returned by a host tool executor.
 */
model HostToolResult {
  @doc("Stable host execution request identifier")
  @sample(HostToolResultRequestIdSample)
  requestId?: string;

  @doc("Associated model tool call identifier, when available")
  @sample(HostToolResultToolCallIdSample)
  toolCallId?: string;

  @doc("Name of the host tool that executed")
  @sample(HostToolResultToolNameSample)
  toolName: string;

  @doc("Whether the host execution completed successfully")
  @sample(HostToolResultSuccessSample)
  success: boolean;

  @doc("Host-normalized execution result")
  result?: unknown;

  @doc("Process or host exit code, when applicable")
  @sample(HostToolResultExitCodeSample)
  exitCode?: int32;

  @doc("Tool execution duration in milliseconds")
  @sample(HostToolResultDurationMsSample)
  durationMs?: float64;

  @doc("Machine-readable error category when success is false")
  @sample(HostToolResultErrorKindSample)
  errorKind?: string;

  @doc("Host-specific telemetry for the execution")
  telemetry?: Record<unknown>;
}

/**
 * Payload for "hook_start" events — a host lifecycle hook is beginning.
 */
model HookStartPayload {
  @doc("Stable hook invocation identifier")
  @sample(HookStartPayloadHookInvocationIdSample)
  hookInvocationId: string;

  @doc("Host-defined hook type")
  @sample(HookStartPayloadHookTypeSample)
  hookType: string;

  @doc("Whether the hook is scoped to a turn or the outer session")
  scope?: HookStartScope;

  @doc("Hook input after host-side sanitization")
  input?: Record<unknown>;

  @doc("Redaction state for sensitive hook input fields")
  redaction?: RedactionMetadata;
}

/**
 * Payload for "hook_end" events — a host lifecycle hook finished.
 */
model HookEndPayload {
  @doc("Stable hook invocation identifier")
  @sample(HookEndPayloadHookInvocationIdSample)
  hookInvocationId: string;

  @doc("Host-defined hook type")
  @sample(HookEndPayloadHookTypeSample)
  hookType: string;

  @doc("Whether the hook is scoped to a turn or the outer session")
  scope?: HookEndScope;

  @doc("Whether the hook completed successfully")
  @sample(HookEndPayloadSuccessSample)
  success: boolean;

  @doc("Hook output after host-side sanitization")
  output?: Record<unknown>;

  @doc("Hook execution duration in milliseconds")
  @sample(HookEndPayloadDurationMsSample)
  durationMs?: float64;

  @doc("Human-readable error when success is false")
  @sample(HookEndPayloadErrorSample)
  error?: string;

  @doc("Redaction state for sensitive hook output fields")
  redaction?: RedactionMetadata;
}

/**
 * Payload for "tool_result" events — a tool has returned its result.
 */
model ToolResultPayload {
  @doc("The name of the tool that produced the result")
  @sample(ToolResultPayloadNameSample)
  name: string;

  @doc("The tool's result")
  @sample(ToolResultPayloadResultSample)
  result: ToolResult;
}

/**
 * Payload for "status" events — informational messages about loop progress.
 */
model StatusEventPayload {
  @doc("Human-readable status message")
  @sample(StatusEventPayloadMessageSample)
  message: string;
}

/**
 * Payload for "messages_updated" events — the conversation state has changed.
 */
model MessagesUpdatedPayload {
  @doc("The current full message list after the update")
  messages?: Message[];

  @doc("Why the message list changed")
  @sample(MessagesUpdatedPayloadReasonSample)
  reason?: string;

  @doc("Messages appended by this update, when available")
  appended?: Message[];

  @doc("Number of messages removed by this update, when available")
  @sample(MessagesUpdatedPayloadRemovedSample)
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
  @sample(ErrorEventPayloadMessageSample)
  message: string;

  @doc("Stable machine-readable error category")
  @sample(ErrorEventPayloadErrorKindSample)
  errorKind?: string;

  @doc("Operation or phase where the error occurred")
  @sample(ErrorEventPayloadPhaseSample)
  phase?: string;
}

/**
 * Payload for "compaction_start" events — context compaction is beginning.
 */
model CompactionStartPayload {
  @doc("Number of messages selected for compaction")
  @sample(CompactionStartPayloadDroppedCountSample)
  droppedCount: int32;
}

/**
 * Payload for "compaction_complete" events — context compaction finished.
 */
model CompactionCompletePayload {
  @doc("Number of messages removed during compaction")
  @sample(CompactionCompletePayloadRemovedSample)
  removed: int32;

  @doc("Number of messages remaining after compaction")
  @sample(CompactionCompletePayloadRemainingSample)
  remaining: int32;

  @doc("Length of the generated summary, when a summarization strategy is used")
  @sample(CompactionCompletePayloadSummaryLengthSample)
  summaryLength?: int32;
}

/**
 * Payload for "compaction_failed" events — compaction could not be completed.
 */
model CompactionFailedPayload {
  @doc("Explanation of why compaction failed")
  @sample(CompactionFailedPayloadMessageSample)
  message: string;
}

/**
 * Summary statistics for a completed turn trace.
 */
model TurnSummary {
  @doc("Stable identifier for the outer turn")
  @sample(TurnSummaryTurnIdSample)
  turnId: string;

  @doc("Final turn status: 'success', 'error', or 'cancelled'")
  @sample(TurnSummaryStatusSample)
  status: string;

  @doc("Number of agent-loop iterations")
  @sample(TurnSummaryIterationsSample)
  iterations: int32;

  @doc("Number of LLM calls made during the turn")
  @sample(TurnSummaryLlmCallsSample)
  llmCalls?: int32;

  @doc("Number of tool calls dispatched during the turn")
  @sample(TurnSummaryToolCallsSample)
  toolCalls?: int32;

  @doc("Number of retry events during the turn")
  @sample(TurnSummaryRetriesSample)
  retries?: int32;

  @doc("Aggregated token usage for the turn")
  usage?: TokenUsage;

  @doc("Total elapsed turn duration in milliseconds")
  @sample(TurnSummaryDurationMsSample)
  durationMs?: float64;
}

/**
 * Portable JSONL/replay container for a recorded turn harness run.
 */
model TurnTrace {
  @doc("Trace schema version")
  @sample(TurnTraceVersionSample)
  version: string = "1";

  @doc("Runtime name that produced the trace")
  @sample(TurnTraceRuntimeSample)
  runtime?: string;

  @doc("Prompty library version that produced the trace")
  @sample(TurnTracePromptyVersionSample)
  promptyVersion?: string;

  @doc("Recorded turn events in emission order")
  events: TurnEvent[];

  @doc("Optional summary computed from the event stream")
  summary?: TurnSummary;
}

/**
 * How a sensitive field was handled before persistence or emission.
 */
alias RedactionMode = "none" | "redacted" | "hashed" | "summary" | "reference";

/**
 * Redaction handling for one JSON-shaped field path.
 */
model RedactedField {
  @doc("JSONPath-like field path, relative to the containing payload")
  @sample(RedactedFieldPathSample)
  path: string;

  @doc("How the field was represented")
  @sample(RedactedFieldModeSample)
  mode: RedactionMode;

  @doc("Human-readable reason or policy that caused this handling")
  @sample(RedactedFieldReasonSample)
  reason?: string;
}

/**
 * Metadata describing whether and how a payload was sanitized.
 */
model RedactionMetadata {
  @doc("Whether the payload has been sanitized for persistence or external display")
  @sample(RedactionMetadataSanitizedSample)
  sanitized?: boolean = false;

  @doc("Field-level redaction details")
  fields?: RedactedField[];

  @doc("Host policy or sanitizer version that produced this metadata")
  @sample(RedactionMetadataPolicySample)
  policy?: string;
}
