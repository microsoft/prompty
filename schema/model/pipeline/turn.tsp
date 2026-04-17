import "prompty-emitter";

namespace Prompty;

/**
 * Configuration for the agent loop's turn() function. Controls iteration
 * limits, retry policy, context management, and execution behavior.
 *
 * Runtimes accept these as either a TurnOptions object or individual
 * keyword/named parameters — the TypeSpec model defines the canonical
 * field set.
 */
model TurnOptions {
  @doc("Maximum number of tool-call iterations before the loop terminates")
  @sample(#{ maxIterations: 10 })
  maxIterations?: int32 = 10;

  @doc("Maximum number of LLM call retries on transient failure within a single iteration")
  @sample(#{ maxLlmRetries: 3 })
  maxLlmRetries?: int32 = 3;

  @doc("Character budget for the context window. When set, the loop trims older messages to stay within budget before each LLM call. System messages are never dropped.")
  @sample(#{ contextBudget: 100000 })
  contextBudget?: int32;

  @doc("Whether to execute multiple tool calls concurrently when the LLM returns several in one response")
  @sample(#{ parallelToolCalls: true })
  parallelToolCalls?: boolean = false;

  @doc("When true, return the raw LLM response without processor post-processing")
  @sample(#{ raw: false })
  raw?: boolean = false;

  @doc("Turn number for trace labeling. Useful when the caller maintains an outer conversation loop.")
  @sample(#{ turn: 1 })
  turn?: int32;

  @doc("Context compaction configuration. Controls how messages are summarized when the context window exceeds the budget.")
  @sample(#{ compaction: #{ strategy: "summarize" } })
  compaction?: CompactionConfig;
}

/**
 * Configuration for context window compaction. When the message history
 * exceeds the context budget, the compaction strategy is applied to
 * reduce the message list while preserving essential information.
 */
model CompactionConfig {
  @doc("The compaction strategy identifier. Built-in strategies include 'summarize'. Can also be a path to a .prompty file used as the summarization prompt.")
  @sample(#{ strategy: "summarize" })
  strategy?: string;

  @doc("Character budget for the compacted context. Overrides TurnOptions.contextBudget when set.")
  @sample(#{ budget: 50000 })
  budget?: int32;

  @doc("Additional strategy-specific options")
  @sample(#{ options: #{ preserveSystemMessages: true } })
  options?: Record<unknown> = #{};
}
