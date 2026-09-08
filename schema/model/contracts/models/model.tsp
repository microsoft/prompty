import "../core/core.tsp";
import "../connectivity/connection.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Connectivity;
namespace Prompty.Contracts.Models;

alias apiType = "chat" | "embedding" | "image" | "responses" | string;

/**
 * Reasoning effort levels for frontier/reasoning models. Mirrors the OpenAI
 * `reasoning_effort` enum. The bare `string` member keeps the set OPEN so
 * provider-specific or future values pass through untyped rather than erroring.
 *
 * Newer reasoning models increasingly gate output quality on this control
 * rather than scalar sampling (`temperature`/`topP`/`topK`), which several
 * providers now reject on those models. Executors are responsible for dropping
 * unsupported sampling params per target model.
 */
alias reasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | string;

/**
 * Options for configuring the behavior of the AI model.
 */
model ModelOptions {
  @doc("The frequency penalty to apply to the model's output")
  @sample(ModelOptionsFrequencyPenaltySample)
  frequencyPenalty?: float32;

  @doc("The maximum number of tokens to generate in the output")
  @sample(ModelOptionsMaxOutputTokensSample)
  maxOutputTokens?: int32;

  @doc("The presence penalty to apply to the model's output")
  @sample(ModelOptionsPresencePenaltySample)
  presencePenalty?: float32;

  @doc("The reasoning effort level for reasoning-capable models")
  @sample(ModelOptionsReasoningEffortSample)
  reasoningEffort?: reasoningEffort;

  @doc("A random seed for deterministic output")
  @sample(ModelOptionsSeedSample)
  seed?: int32;

  @doc("The temperature to use for sampling")
  @sample(ModelOptionsTemperatureSample)
  temperature?: float32;

  @doc("The top-K sampling value")
  @sample(ModelOptionsTopKSample)
  topK?: int32;

  @doc("The top-P sampling value")
  @sample(ModelOptionsTopPSample)
  topP?: float32;

  @doc("Stop sequences to end generation")
  @sample(ModelOptionsStopSequencesSample)
  stopSequences?: string[];

  @doc("Whether to allow multiple tool calls in a single response")
  @sample(ModelOptionsAllowMultipleToolCallsSample)
  allowMultipleToolCalls?: boolean;

  @doc("Additional custom properties for model options")
  @sample(ModelOptionsAdditionalPropertiesSample)
  additionalProperties?: Record<unknown>;
}

/**
 * Open discriminator union naming the providers Prompty ships typed conformance
 * seams for, plus a bare `string` escape hatch for downstream/unregistered
 * providers. The bare `string` member keeps the discriminated set OPEN
 * (`isClosed=false`), so an unknown provider value routes to the `CustomModel`
 * fallback rather than hard-erroring at the decl level. The runtime registry is
 * fully open and resolves any provider key (e.g. `foundry`, `anthropic`) via
 * entry points / LIFO overrides / defaults, independent of this typed set.
 */
union ModelProvider {
  openai: "openai",
  azure: "azure",
  string,
}

/**
 * Model for defining the structure and behavior of AI agents.
 * This model includes properties for specifying the model's provider, connection details, and various options.
 * It allows for flexible configuration of AI models to suit different use cases and requirements.
 *
 * `provider` is the `@dispatch` discriminator for the Executor / Processor seams.
 * The string shorthand (`model: "gpt-4"`) coerces to `#{ id }` only — it carries
 * no provider — so `provider` stays optional and absent/unknown providers are
 * resolved by the runtime registry (global defaults) out of band.
 */
@discriminator("provider")
@coerce(
  string,
  #{ id: "{value}" },
  "model",
  "Simple construction with just an id"
)
model Model {
  @doc("The unique identifier of the model - can be used as the single property shorthand")
  @sample(ModelIdSample)
  id: string = "";

  @doc("The provider of the model (e.g., 'openai', 'foundry', 'anthropic')")
  @sample(ModelProviderSample)
  provider?: ModelProvider;

  @doc("The type of API to use for the model (e.g., 'chat', 'response', etc.)")
  @sample(ModelApiTypeSample)
  apiType?: apiType;

  @doc("The connection configuration for the model")
  @sample(ModelConnectionSample)
  connection?: Connection;

  @doc("Additional options for the model")
  @sample(ModelOptionsSample)
  options?: ModelOptions;
}

/**
 * OpenAI-hosted model. Pin-only subtype: pins the `provider` discriminator and
 * inherits every base field.
 */
model OpenAIModel extends Model {
  @doc("The OpenAI provider discriminator")
  provider: "openai";
}

/**
 * Azure OpenAI-hosted model. Pin-only subtype.
 */
model AzureModel extends Model {
  @doc("The Azure provider discriminator")
  provider: "azure";
}

/**
 * Wildcard catch-all model for downstream/unregistered providers. The `"*"`
 * discriminator lowers to the dispatch decl's `defaultVariant` (the fallback
 * seam) while the known providers stay enumerated `variants`. A runtime provider
 * value that is none of the known literals routes here — the downstream-registry
 * delegation hook.
 */
model CustomModel extends Model {
  @doc("The wildcard provider discriminator for any provider not explicitly modeled")
  provider: "*";
}
