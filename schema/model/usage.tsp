import "prompty-emitter";

namespace Prompty;

/**
 * Tracks token consumption for a single LLM call. Provider-specific field
 * names (e.g., OpenAI's `prompt_tokens` vs Anthropic's `input_tokens`)
 * are mapped via `knownAs` augments in the wire directory.
 */
model TokenUsage {
  @doc("Number of tokens in the prompt/input sent to the model")
  @sample(#{ promptTokens: 150 })
  promptTokens?: int32;

  @doc("Number of tokens generated in the model's completion/output")
  @sample(#{ completionTokens: 42 })
  completionTokens?: int32;

  @doc("Total tokens consumed (prompt + completion). May be provided by the API or computed.")
  @sample(#{ totalTokens: 192 })
  totalTokens?: int32;
}
