import "prompty-emitter";
import "./connection.tsp";

namespace Prompty;

/**
 * Connection configuration for Microsoft Foundry projects.
 * Provides project-scoped access to models, tools, and services
 * via Entra ID (DefaultAzureCredential) authentication.
 */
model FoundryConnection extends Connection {
  @doc("The connection kind for Foundry project access")
  @sample(#{ kind: "foundry" })
  kind: "foundry";

  @doc("The Foundry project endpoint URL")
  @sample(#{
    endpoint: "https://myresource.services.ai.azure.com/api/projects/myproject",
  })
  endpoint: string;

  @doc("The named connection within the Foundry project")
  @sample(#{ name: "my-openai-connection" })
  name?: string;

  @doc("The connection type within the Foundry project (e.g., 'model', 'index', 'storage')")
  @sample(#{ connectionType: "model" })
  connectionType?: string;
}
