import "../core/core.tsp";
import "../connection/connection.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Connectivity;
namespace Prompty.Contracts.Models;

alias apiType = "chat" | "embedding" | "image" | "responses" | string;
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
 * Model for defining the structure and behavior of AI agents.
 * This model includes properties for specifying the model's provider, connection details, and various options.
 * It allows for flexible configuration of AI models to suit different use cases and requirements.
 */
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
  provider?: string;

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
