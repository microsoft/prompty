import "prompty-emitter";

namespace Prompty;

/**
 * Information about a model available from a provider. Used by provider-level
 * model discovery to report which models are available and their capabilities.
 *
 * Not all providers return all fields — implementations SHOULD populate as
 * many fields as the provider's API supports and MAY enrich sparse results
 * from a built-in lookup table of known models.
 */
model ModelInfo {
  @doc("The model identifier (e.g., 'gpt-4o', 'claude-3-opus')")
  @sample(#{ id: "gpt-4o" })
  id: string;

  @doc("Human-readable display name")
  @sample(#{ displayName: "GPT-4o" })
  displayName?: string;

  @doc("The organization or entity that owns the model")
  @sample(#{ ownedBy: "openai" })
  ownedBy?: string;

  @doc("Maximum context window size in tokens")
  @sample(#{ contextWindow: 128000 })
  contextWindow?: int32;

  @doc("Input modalities the model accepts (e.g., 'text', 'image', 'audio')")
  @sample(#{ inputModalities: #["text", "image"] })
  inputModalities?: string[];

  @doc("Output modalities the model can produce (e.g., 'text', 'audio')")
  @sample(#{ outputModalities: #["text"] })
  outputModalities?: string[];

  @doc("Additional provider-specific properties")
  @sample(#{ additionalProperties: #{ supportsStreaming: true } })
  additionalProperties?: Record<unknown>;
}
