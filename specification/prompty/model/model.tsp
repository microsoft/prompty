import "./core.tsp";
import "./connection.tsp";

namespace Prompty.Core {
  alias apiType = "chat" | "completion" | "embedding" | "image" | string;
  /**
   * Options for configuring the behavior of the AI model.
   * `type` is a required property here, but this section can accept additional via options.
   */
  @discriminator("type")
  model ModelOptions {
    type: apiType;
  }

  /**
   * Model for defining the structure and behavior of AI agents.
   * Yaml Example:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model:
   *   id: gpt-35-turbo
   *   connection:
   *     provider: azure
   *     type: chat
   *     endpoint: https://{your-custom-endpoint}.openai.azure.com/
   * ```
   *
   * A shorthand representation of the model configuration can also be constructed as
   * follows:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model: gpt-35-turbo
   * ```
   * This will be expanded as follows:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model:
   *   id: gpt-35-turbo
   * ```
   */
  @discriminator("provider")
  model Model {
    @doc("The unique identifier of the model - can be used as the single property shorthand")
    @sample(#{ id: "gpt-35-turbo" })
    id: string = "";

    @doc("The provider of the model (e.g., 'openai', 'azure', 'anthropic')")
    @sample(#{ provider: "azure" })
    provider?: string;

    @doc("The connection configuration for the model")
    @sample(#{
      connection: #{
        authType: "key",
        endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
      },
    })
    connection?: Connection;

    @doc("Additional options for the model")
    @sample(#{
      options: #{
        type: "chat",
        temperature: 0.7,
        maxTokens: 1000,
      },
    })
    options?: ModelOptions;
  }
}
