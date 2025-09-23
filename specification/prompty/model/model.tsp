import "./core.tsp";
import "./connection.tsp";

namespace Prompty.Core {
  alias apiType = "chat" | "completion" | "embedding" | "image" | string;
  /**
   * Options for configuring the behavior of the AI model.
   * `kind` is a required property here, but this section can accept additional via options.
   */
  @discriminator("kind")
  model ModelOptions {
    kind: apiType;
  }

  /**
   * Model for defining the structure and behavior of AI agents.
   * This model includes properties for specifying the model's provider, connection details, and various options.
   * It allows for flexible configuration of AI models to suit different use cases and requirements.
   */
  @discriminator("provider")
  @shorthand(string, #{ id: "{value}" }, "model", "Simple construction with just an id")
  model Model {
    @doc("The unique identifier of the model - can be used as the single property shorthand")
    @sample(#{ id: "gpt-35-turbo" })
    id: string = "";

    @doc("The publisher of the model (e.g., 'openai', 'azure', 'anthropic')")
    @sample(#{ publisher: "azure" })
    publisher?: string;

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
    @sample(#{ options: #{ type: "chat", temperature: 0.7, maxTokens: 1000 } })
    options?: ModelOptions;
  }
}
