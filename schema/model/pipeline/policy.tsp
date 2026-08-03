import "@typra/emitter";
import "../conversation/message.tsp";

namespace Prompty;

/** Host-owned deterministic state supplied before one model invocation. */
model HostPolicyRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages entering the invocation")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Turn inputs")
  inputs?: unknown;
}

/** State rewrite produced by the host policy before a model invocation. */
model HostPolicyResult {
  @doc("Canonical messages to use for the invocation")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Opaque host-specific policy metadata")
  metadata?: Record<unknown> = #{};
}

/** Final output supplied to the host policy immediately before a success commit. */
model FinalOutputPolicyRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages at commit time")
  messages: Message[] = #[];

  @doc("Proposed final output")
  output?: unknown;

  @doc("Turn inputs")
  inputs?: unknown;
}

/** Final output rewrite produced by the host policy before commit. */
model FinalOutputPolicyResult {
  @doc("Rewritten final output")
  output?: unknown;

  @doc("Opaque host-specific policy metadata")
  metadata?: Record<unknown> = #{};
}

/** Context supplied to the retry policy after a retryable model failure. */
model RetryPolicyRequest {
  @doc("Number of failures observed for this invocation, starting at one")
  failedAttempts: int32;

  @doc("One-based attempt number that will run after backoff")
  nextAttempt: int32;

  @doc("Maximum attempts permitted for the invocation")
  maxAttempts: int32;

  @doc("Human-readable reason for the retry")
  reason: string;
}
