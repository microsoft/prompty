import "@typra/emitter";
import "../core/core.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Core;
namespace Prompty.Contracts.Connectivity;

alias ConnectionType =
  | "remote"
  | "reference"
  | "key"
  | "anonymous"
  | "foundry"
  | "oauth";
alias AuthenticationMode = "user" | "system";

/**
 * Connection configuration for AI agents.
 * `provider`, `kind`, and `endpoint` are required properties here,
 * but this section can accept additional via options.
 */
@abstract
@discriminator("kind")
model Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(ConnectionKindSample)
  kind: ConnectionType;

  @doc("The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')")
  @sample(ConnectionAuthenticationModeSample)
  authenticationMode?: AuthenticationMode;

  @doc("The usage description for the connection, providing context on how this connection will be used")
  @sample(ConnectionUsageDescriptionSample)
  usageDescription?: string;
}

alias Connections = Record<Connection> | Named<
  Connection,
  "Name of the connection",
  #{ name: "my-connection" }
>[];

/**
 * Connection configuration for AI services using named connections.
 */
model ReferenceConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(ReferenceConnectionKindSample)
  kind: "reference";

  @doc("The name of the connection")
  @sample(ReferenceConnectionNameSample)
  name: string;

  @doc("The target resource or service that this connection refers to")
  @sample(ReferenceConnectionTargetSample)
  target?: string;
}

/**
 * Connection configuration for AI services using named connections.
 */
model RemoteConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(RemoteConnectionKindSample)
  kind: "remote";

  @doc("The name of the connection")
  @sample(RemoteConnectionNameSample)
  name: string;

  @doc("The endpoint URL for the AI service")
  @sample(RemoteConnectionEndpointSample)
  endpoint: string;
}

/**
 * Connection configuration for AI services using API keys.
 */
model ApiKeyConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(ApiKeyConnectionKindSample)
  kind: "key";

  @doc("The endpoint URL for the AI service")
  @sample(ApiKeyConnectionEndpointSample)
  endpoint: string;

  @doc("The API key for authenticating with the AI service")
  @sample(ApiKeyConnectionApiKeySample)
  apiKey: string;
}

model AnonymousConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(AnonymousConnectionKindSample)
  kind: "anonymous";

  @doc("The endpoint for authenticating with the AI service")
  @sample(AnonymousConnectionEndpointSample)
  endpoint: string;
}
