import "@typra/emitter";

namespace Prompty;

/** Lists models available through a provider connection. */
interface ModelLister {
  @doc("List models available through a provider connection")
  listModels(connection: unknown): ModelInfo[];
}

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
  @sample(availableIdSample)
  id: string;

  @doc("Human-readable display name")
  @sample(availableDisplayNameSample)
  displayName?: string;

  @doc("The organization or entity that owns the model")
  @sample(availableOwnedBySample)
  ownedBy?: string;

  @doc("Maximum context window size in tokens")
  @sample(availableContextWindowSample)
  contextWindow?: int32;

  @doc("Input modalities the model accepts (e.g., 'text', 'image', 'audio')")
  @sample(availableInputModalitiesSample)
  inputModalities?: string[];

  @doc("Output modalities the model can produce (e.g., 'text', 'audio')")
  @sample(availableOutputModalitiesSample)
  outputModalities?: string[];

  @doc("Additional provider-specific properties")
  @sample(availableAdditionalPropertiesSample)
  additionalProperties?: Record<unknown>;
}
