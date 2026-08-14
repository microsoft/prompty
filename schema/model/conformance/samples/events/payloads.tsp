// Named sample constants for events/payloads.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const fileIdSample = #{ id: "evt_abc123" };

const fileTimestampSample = #{ timestamp: "2026-06-09T20:00:00Z" };

const fileTurnIdSample = #{ turnId: "turn_001" };

const fileIterationSample = #{ iteration: 0 };

const fileParentIdSample = #{ parentId: "evt_parent" };

const fileSpanIdSample = #{ spanId: "span_tool_001" };

const TurnStartPayloadAgentSample = #{ agent: "weather-agent" };

const TurnStartPayloadMaxIterationsSample = #{ maxIterations: 10 };

const TurnEndPayloadIterationsSample = #{ iterations: 2 };

const TurnEndPayloadDurationMsSample = #{ durationMs: 1500 };

const LlmStartPayloadProviderSample = #{ provider: "openai" };

const LlmStartPayloadModelIdSample = #{ modelId: "gpt-4o-mini" };

const LlmStartPayloadMessageCountSample = #{ messageCount: 4 };

const LlmStartPayloadAttemptSample = #{ attempt: 0 };

const LlmCompletePayloadRequestIdSample = #{ requestId: "req_abc123" };

const LlmCompletePayloadServiceRequestIdSample = #{
  serviceRequestId: "srv_abc123",
};

const LlmCompletePayloadDurationMsSample = #{ durationMs: 820 };

const RetryPayloadOperationSample = #{ operation: "llm" };

const RetryPayloadAttemptSample = #{ attempt: 2 };

const RetryPayloadMaxAttemptsSample = #{ maxAttempts: 3 };

const RetryPayloadDelayMsSample = #{ delayMs: 1250 };

const RetryPayloadReasonSample = #{ reason: "rate_limit" };

const PermissionRequestedPayloadRequestIdSample = #{ requestId: "perm_abc123" };

const PermissionRequestedPayloadToolCallIdSample = #{
  toolCallId: "call_abc123",
};

const PermissionRequestedPayloadPermissionSample = #{
  permission: "tool.execute",
};

const PermissionRequestedPayloadTargetSample = #{ target: "shell" };

const PermissionRequestedPayloadPromptRequestSample = #{
  promptRequest: "Allow shell to run tests?",
};

const PermissionCompletedPayloadRequestIdSample = #{ requestId: "perm_abc123" };

const PermissionCompletedPayloadToolCallIdSample = #{
  toolCallId: "call_abc123",
};

const PermissionCompletedPayloadPermissionSample = #{
  permission: "tool.execute",
};

const PermissionCompletedPayloadApprovedSample = #{ approved: true };

const PermissionCompletedPayloadReasonSample = #{ reason: "user_approved" };

const PermissionRequestRequestIdSample = #{ requestId: "perm_abc123" };

const PermissionRequestToolCallIdSample = #{ toolCallId: "call_abc123" };

const PermissionRequestPermissionSample = #{ permission: "tool.execute" };

const PermissionRequestTargetSample = #{ target: "shell" };

const PermissionRequestPromptRequestSample = #{
  promptRequest: "Allow shell to run tests?",
};

const PermissionDecisionRequestIdSample = #{ requestId: "perm_abc123" };

const PermissionDecisionToolCallIdSample = #{ toolCallId: "call_abc123" };

const PermissionDecisionPermissionSample = #{ permission: "tool.execute" };

const PermissionDecisionApprovedSample = #{ approved: true };

const PermissionDecisionReasonSample = #{ reason: "user_approved" };

const TokenEventPayloadTokenSample = #{ token: "Hello" };

const ThinkingEventPayloadTokenSample = #{ token: "Let me consider..." };

const ToolCallStartPayloadIdSample = #{ id: "call_abc123" };

const ToolCallStartPayloadNameSample = #{ name: "get_weather" };

const ToolCallStartPayloadArgumentsSample = #{
  arguments: "{\"city\": \"Paris\"}",
};

const ToolCallCompletePayloadIdSample = #{ id: "call_abc123" };

const ToolCallCompletePayloadNameSample = #{ name: "get_weather" };

const ToolCallCompletePayloadSuccessSample = #{ success: true };

const ToolCallCompletePayloadDurationMsSample = #{ durationMs: 42 };

const ToolCallCompletePayloadErrorKindSample = #{ errorKind: "timeout" };

const requestingRequestIdSample = #{ requestId: "exec_abc123" };

const requestingToolCallIdSample = #{ toolCallId: "call_abc123" };

const requestingToolNameSample = #{ toolName: "powershell" };

const requestingWorkingDirectorySample = #{
  workingDirectory: "/workspace/project",
};

const ToolExecutionCompletePayloadRequestIdSample = #{
  requestId: "exec_abc123",
};

const ToolExecutionCompletePayloadToolCallIdSample = #{
  toolCallId: "call_abc123",
};

const ToolExecutionCompletePayloadToolNameSample = #{ toolName: "powershell" };

const ToolExecutionCompletePayloadSuccessSample = #{ success: true };

const ToolExecutionCompletePayloadExitCodeSample = #{ exitCode: 0 };

const ToolExecutionCompletePayloadDurationMsSample = #{ durationMs: 250 };

const ToolExecutionCompletePayloadErrorKindSample = #{ errorKind: "timeout" };

const HostToolRequestRequestIdSample = #{ requestId: "exec_abc123" };

const HostToolRequestToolCallIdSample = #{ toolCallId: "call_abc123" };

const HostToolRequestToolNameSample = #{ toolName: "powershell" };

const HostToolRequestWorkingDirectorySample = #{
  workingDirectory: "/workspace/project",
};

const HostToolResultRequestIdSample = #{ requestId: "exec_abc123" };

const HostToolResultToolCallIdSample = #{ toolCallId: "call_abc123" };

const HostToolResultToolNameSample = #{ toolName: "powershell" };

const HostToolResultSuccessSample = #{ success: true };

const HostToolResultExitCodeSample = #{ exitCode: 0 };

const HostToolResultDurationMsSample = #{ durationMs: 250 };

const HostToolResultErrorKindSample = #{ errorKind: "timeout" };

const HookStartPayloadHookInvocationIdSample = #{
  hookInvocationId: "hook_abc123",
};

const HookStartPayloadHookTypeSample = #{ hookType: "preToolUse" };

const HookEndPayloadHookInvocationIdSample = #{
  hookInvocationId: "hook_abc123",
};

const HookEndPayloadHookTypeSample = #{ hookType: "preToolUse" };

const HookEndPayloadSuccessSample = #{ success: true };

const HookEndPayloadDurationMsSample = #{ durationMs: 12 };

const HookEndPayloadErrorSample = #{ error: "hook failed" };

const ToolResultPayloadNameSample = #{ name: "get_weather" };

const ToolResultPayloadResultSample = #{
  result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
};

const StatusEventPayloadMessageSample = #{ message: "Starting iteration 3" };

const MessagesUpdatedPayloadReasonSample = #{ reason: "tool_results" };

const MessagesUpdatedPayloadRemovedSample = #{ removed: 2 };

const ErrorEventPayloadMessageSample = #{ message: "Rate limit exceeded" };

const ErrorEventPayloadErrorKindSample = #{ errorKind: "rate_limit" };

const ErrorEventPayloadPhaseSample = #{ phase: "llm" };

const CompactionStartPayloadDroppedCountSample = #{ droppedCount: 5 };

const CompactionCompletePayloadRemovedSample = #{ removed: 5 };

const CompactionCompletePayloadRemainingSample = #{ remaining: 3 };

const CompactionCompletePayloadSummaryLengthSample = #{ summaryLength: 1200 };

const CompactionFailedPayloadMessageSample = #{
  message: "Summarization prompt exceeded context window",
};

const TurnSummaryTurnIdSample = #{ turnId: "turn_001" };

const TurnSummaryStatusSample = #{ status: "success" };

const TurnSummaryIterationsSample = #{ iterations: 2 };

const TurnSummaryLlmCallsSample = #{ llmCalls: 3 };

const TurnSummaryToolCallsSample = #{ toolCalls: 2 };

const TurnSummaryRetriesSample = #{ retries: 1 };

const TurnSummaryDurationMsSample = #{ durationMs: 2500 };

const TurnTraceVersionSample = #{ version: "1" };

const TurnTraceRuntimeSample = #{ runtime: "typescript" };

const TurnTracePromptyVersionSample = #{ promptyVersion: "2.0.0" };

const RedactedFieldPathSample = #{ path: "$.arguments.apiKey" };

const RedactedFieldModeSample = #{ mode: "redacted" };

const RedactedFieldReasonSample = #{ reason: "secret" };

const RedactionMetadataSanitizedSample = #{ sanitized: true };

const RedactionMetadataPolicySample = #{ policy: "default-v1" };
