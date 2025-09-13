import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";
import "../model.tsp";

namespace Prompty.Core {
  /**
   * The MCP Server tool.
   */
  model ModelTool extends Tool {
    @doc("The kind identifier for MCP tools")
    @sample(#{ kind: "mcp" })
    kind: "model";

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
    @sample(#{ options: #{ type: "chat", temperature: 0.7, maxTokens: 1000 } })
    options?: ModelOptions;
  }
}
