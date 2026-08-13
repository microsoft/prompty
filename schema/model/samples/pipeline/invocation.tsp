// Named sample constants for pipeline/invocation.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const DelegatedStateReferenceProviderSample = #{ provider: "openai" };

const DelegatedStateReferenceKindSample = #{ kind: "response" };

const DelegatedStateReferenceIdSample = #{ id: "resp_abc123" };

const InvocationContextDecisionCandidateIdSample = #{
  candidateId: "memory:project-plan",
};

const InvocationContextDecisionReasonSample = #{
  reason: "included by relevance ranking",
};

const ModelInvocationContextSnapshotIdSample = #{ id: "context:inv_abc123" };

const ModelInvocationContextSnapshotSessionIdSample = #{
  sessionId: "sess_abc123",
};

const ModelInvocationContextSnapshotTurnIdSample = #{ turnId: "turn_abc123" };

const ModelInvocationContextSnapshotInvocationIdSample = #{
  invocationId: "inv_abc123",
};

const providerIdSample = #{ id: "call_abc123" };

const providerNameSample = #{ name: "get_weather" };

const ModelToolResultRequestIdSample = #{ requestId: "call_abc123" };

const ModelToolResultNameSample = #{ name: "get_weather" };
