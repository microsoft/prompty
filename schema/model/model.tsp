import "./core.tsp";
import "./connection.tsp";

namespace Prompty;

alias apiType = "chat" | "embedding" | "image" | "responses" | string;
/**
 * Options for configuring the behavior of the AI model.
 */
model ModelOptions {
  @doc("The frequency penalty to apply to the model's output")
  @sample(#{ frequencyPenalty: 0.5 })
  frequencyPenalty?: float32;

  @doc("The maximum number of tokens to generate in the output")
  @sample(#{ maxOutputTokens: 2048 })
  maxOutputTokens?: int32;

  @doc("The presence penalty to apply to the model's output")
  @sample(#{ presencePenalty: 0.3 })
  presencePenalty?: float32;

  @doc("A random seed for deterministic output")
  @sample(#{ seed: 42 })
  seed?: int32;

  @doc("The temperature to use for sampling")
  @sample(#{ temperature: 0.7 })
  temperature?: float32;

  @doc("The top-K sampling value")
  @sample(#{ topK: 40 })
  topK?: int32;

  @doc("The top-P sampling value")
  @sample(#{ topP: 0.9 })
  topP?: float32;

  @doc("Stop sequences to end generation")
  @sample(#{ stopSequences: #["\n", "###"] })
  stopSequences?: string[];

  @doc("Whether to allow multiple tool calls in a single response")
  @sample(#{ allowMultipleToolCalls: true })
  allowMultipleToolCalls?: boolean;

  @doc("Additional custom properties for model options")
  @sample(#{
    additionalProperties: #{
      customProperty: "value",
      anotherProperty: "anotherValue",
    },
  })
  additionalProperties?: Record<unknown>;
}

/**
 * Model for defining the structure and behavior of AI agents.
 * This model includes properties for specifying the model's provider, connection details, and various options.
 * It allows for flexible configuration of AI models to suit different use cases and requirements.
 */
@shorthand(
  string,
  #{ id: "{value}" },
  "model",
  "Simple construction with just an id"
)
model Model {
  @doc("The unique identifier of the model - can be used as the single property shorthand")
  @sample(#{ id: "gpt-35-turbo" })
  id: string = "";

  @doc("The provider of the model (e.g., 'openai', 'foundry', 'anthropic')")
  @sample(#{ provider: "foundry" })
  provider?: string;

  @doc("The type of API to use for the model (e.g., 'chat', 'response', etc.)")
  @sample(#{ apiType: "chat" })
  apiType?: apiType;

  @doc("The connection configuration for the model")
  @sample(#{
    connection: #{
      kind: "key",
      endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
      key: "{your-api-key}",
    },
  })
  connection?: Connection;

  @doc("Additional options for the model")
  @sample(#{ options: #{ type: "chat", temperature: 0.7, maxOutputTokens: 1000 } })
  options?: ModelOptions;
}
