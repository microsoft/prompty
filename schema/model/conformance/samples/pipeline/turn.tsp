// Named sample constants for pipeline/turn.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const definesMaxIterationsSample = #{ maxIterations: 10 };

const definesMaxLlmRetriesSample = #{ maxLlmRetries: 3 };

const definesContextBudgetSample = #{ contextBudget: 100000 };

const definesParallelToolCallsSample = #{ parallelToolCalls: true };

const definesRawSample = #{ raw: false };

const definesTurnSample = #{ turn: 1 };

const definesCompactionSample = #{ compaction: #{ strategy: "summarize" } };

const CompactionConfigStrategySample = #{ strategy: "summarize" };

const CompactionConfigBudgetSample = #{ budget: 50000 };

const CompactionConfigOptionsSample = #{
  options: #{ preserveSystemMessages: true },
};

const callbackSessionIdSample = #{ sessionId: "sess_abc123" };

const callbackTurnIdSample = #{ turnId: "turn_abc123" };

const callbackIterationSample = #{ iteration: 0 };

const RunTurnRequestSessionIdSample = #{ sessionId: "sess_abc123" };

const RunTurnRequestTurnIdSample = #{ turnId: "turn_abc123" };

const RunTurnResultSessionIdSample = #{ sessionId: "sess_abc123" };

const RunTurnResultTurnIdSample = #{ turnId: "turn_abc123" };

const RunTurnResultIterationsSample = #{ iterations: 1 };
