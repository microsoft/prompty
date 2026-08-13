import "@typra/emitter";
import "../conversation/message.tsp";
import "./invocation.tsp";

namespace Prompty;

/** Planning input handed to the context pipeline before one model invocation. */
model ContextRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Stable model invocation identifier")
  invocationId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages entering context planning")
  messages: Message[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Provider-context state entering this invocation")
  contextState: InvocationContextState;

  @doc("Turn inputs")
  inputs?: unknown;
}

/** A context contribution before filtering, ranking, and packing. */
model ContextCandidate {
  @doc("Stable candidate identifier")
  @sample(ContextCandidateIdSample)
  id: string;

  @doc("Host-defined source of the candidate")
  @sample(ContextCandidateSourceSample)
  source: string;

  @doc("Messages contributed by the candidate")
  messages: Message[];

  @doc("Opaque host-specific candidate metadata")
  metadata?: Record<unknown>;
}
