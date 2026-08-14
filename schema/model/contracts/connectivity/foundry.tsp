import "@typra/emitter";
import "./connection.tsp";

using Prompty.Conformance.Samples;
namespace Prompty.Contracts.Connectivity;

/**
 * Connection configuration for Microsoft Foundry projects.
 * Provides project-scoped access to models, tools, and services
 * via Entra ID (DefaultAzureCredential) authentication.
 */
model FoundryConnection extends Connection {
  @doc("The connection kind for Foundry project access")
  @sample(FoundryConnectionKindSample)
  kind: "foundry";

  @doc("The Foundry project endpoint URL")
  @sample(FoundryConnectionEndpointSample)
  endpoint: string;

  @doc("The named connection within the Foundry project")
  @sample(FoundryConnectionNameSample)
  name?: string;

  @doc("The connection type within the Foundry project (e.g., 'model', 'index', 'storage')")
  @sample(FoundryConnectionConnectionTypeSample)
  connectionType?: string;
}
