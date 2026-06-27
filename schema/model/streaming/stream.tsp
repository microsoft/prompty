import "@typra/emitter";

namespace Prompty;

/**
 * Options controlling streaming behavior for LLM API calls.
 * Passed alongside the model options when streaming is enabled.
 */
model StreamOptions {
  @doc("When true, the final streaming chunk includes token usage statistics")
  @sample(#{ includeUsage: true })
  includeUsage?: boolean;
}
