import "@typra/emitter";
import "../conversation/message.tsp";
import "../model/usage.tsp";

namespace Prompty;

/**
 * Describes how completely an invocation can be reconstructed outside its provider.
 */
alias InvocationContextPortability = "portable" | "delegated" | "opaque";

/**
 * A reference to model-visible state retained by a provider.
 */
model DelegatedStateReference {
  @doc("Provider that owns the retained state")
  @sample(#{ provider: "openai" })
  provider: string;

  @doc("Provider-defined kind of retained state")
  @sample(#{ kind: "response" })
  kind: string;

  @doc("Provider-defined identifier for the retained state")
  @sample(#{ id: "resp_abc123" })
  id: string;

  @doc("Opaque provider-specific state reference metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Provider-context state carried into or out of an invocation.
 */
model InvocationContextState {
  @doc("Whether the model-visible context is portable across providers")
  portability: InvocationContextPortability = "portable";

  @doc("Explicit references to provider-held context state")
  delegatedState?: DelegatedStateReference[] = #[];
}

/**
 * The disposition of a context candidate while preparing an invocation.
 */
alias InvocationContextDisposition = "included" | "excluded";

/**
 * An auditable decision made while preparing model-visible context.
 */
model InvocationContextDecision {
  @doc("Stable identifier of the evaluated context candidate")
  @sample(#{ candidateId: "memory:project-plan" })
  candidateId: string;

  @doc("Whether the candidate was included in the invocation context")
  disposition: InvocationContextDisposition;

  @doc("Human-readable reason for the disposition")
  @sample(#{ reason: "included by relevance ranking" })
  reason: string;

  @doc("Zero-based rank among included candidates, when applicable")
  rank?: int32;

  @doc("Estimated token count for the candidate, when available")
  estimatedTokens?: int32;

  @doc("Opaque host-specific decision metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Immutable model-visible context for a single provider invocation.
 *
 * Retries of the same invocation MUST reuse the same snapshot.
 */
model ModelInvocationContextSnapshot {
  @doc("Stable identifier for this context snapshot")
  @sample(#{ id: "context:inv_abc123" })
  id: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Stable model invocation identifier")
  @sample(#{ invocationId: "inv_abc123" })
  invocationId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages visible to the model")
  messages: Message[] = #[];

  @doc("Context-planning decisions used to assemble the snapshot")
  decisions?: InvocationContextDecision[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Provider-context state carried into this invocation")
  contextState: InvocationContextState;

  @doc("Opaque host-specific snapshot metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Normalized request for a single model-provider invocation.
 */
model ModelInvocationRequest {
  @doc("Immutable model-visible context for this invocation")
  context: ModelInvocationContextSnapshot;
}

/**
 * A normalized tool request returned by a model provider.
 *
 * Arguments remain JSON-shaped because providers may return a parsed object or
 * a serialized JSON value before the host's tool binding is selected.
 */
model ModelToolRequest {
  @doc("Provider-stable tool request identifier")
  @sample(#{ id: "call_abc123" })
  id: string;

  @doc("Name of the requested tool")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("Provider-normalized tool arguments")
  arguments?: unknown;

  @doc("Opaque provider-specific tool request metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Semantic outcome of an external tool effect.
 */
alias ModelToolOutcome = "success" | "failed" | "indeterminate";

/**
 * Normalized result of executing one model-requested tool.
 */
model ModelToolResult {
  @doc("Identifier of the corresponding model tool request")
  @sample(#{ requestId: "call_abc123" })
  requestId: string;

  @doc("Name of the executed tool")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("Semantic outcome of the external tool effect")
  outcome: ModelToolOutcome;

  @doc("JSON-shaped tool output when available")
  output?: unknown;

  @doc("Stable error category for failed or indeterminate results")
  errorKind?: string;

  @doc("Opaque host-specific tool result metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Provider-neutral result of a single model invocation.
 *
 * This is the live provider boundary. It is intentionally distinct from
 * TurnModelResponse, which is the deterministic reference-runner callback.
 */
model ModelInvocationResponse {
  @doc("Provider-neutral final output when no additional tool calls are requested")
  output?: unknown;

  @doc("Complete cumulative token usage for this completed invocation, when available")
  usage?: InvocationUsage;

  @doc("Assistant messages to commit before tool results are made visible")
  assistantMessages?: Message[] = #[];

  @doc("Tool requests returned by the provider")
  toolRequests?: ModelToolRequest[] = #[];

  @doc("Provider-context state to carry into the next invocation")
  nextContextState?: InvocationContextState;

  @doc("Opaque provider-specific response metadata")
  metadata?: Record<unknown> = #{};
}
