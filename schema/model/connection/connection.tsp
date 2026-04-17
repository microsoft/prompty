import "prompty-emitter";
import "../core/core.tsp";

namespace Prompty;

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
  @sample(#{ kind: "reference" })
  kind: ConnectionType;

  @doc("The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')")
  @sample(#{ authenticationMode: "system" })
  authenticationMode?: AuthenticationMode;

  @doc("The usage description for the connection, providing context on how this connection will be used")
  @sample(#{
    usageDescription: "This will allow the agent to respond to an email on your behalf",
  })
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
  @sample(#{ kind: "reference" })
  kind: "reference";

  @doc("The name of the connection")
  @sample(#{ name: "my-reference-connection" })
  name: string;

  @doc("The target resource or service that this connection refers to")
  @sample(#{ target: "my-target-resource" })
  target?: string;
}

/**
 * Connection configuration for AI services using named connections.
 */
model RemoteConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(#{ kind: "remote" })
  kind: "remote";

  @doc("The name of the connection")
  @sample(#{ name: "my-reference-connection" })
  name: string;

  @doc("The endpoint URL for the AI service")
  @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
  endpoint: string;
}

/**
 * Connection configuration for AI services using API keys.
 */
model ApiKeyConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(#{ kind: "key" })
  kind: "key";

  @doc("The endpoint URL for the AI service")
  @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
  endpoint: string;

  @doc("The API key for authenticating with the AI service")
  @sample(#{ apiKey: "your-api-key" })
  apiKey: string;
}

model AnonymousConnection extends Connection {
  @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
  @sample(#{ kind: "anonymous" })
  kind: "anonymous";

  @doc("The endpoint for authenticating with the AI service")
  @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
  endpoint: string;
}
