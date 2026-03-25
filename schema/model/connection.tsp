import "agentschema-emitter";
import "./core.tsp";

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
  authenticationMode: AuthenticationMode = "system";

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

/**
 * Connection configuration using OAuth 2.0 client credentials.
 * Useful for tools and services that require OAuth authentication,
 * such as MCP servers, OpenAPI endpoints, or other REST APIs.
 */
model OAuthConnection extends Connection {
  @doc("The connection kind for OAuth authentication")
  @sample(#{ kind: "oauth" })
  kind: "oauth";

  @doc("The endpoint URL for the service")
  @sample(#{ endpoint: "https://api.example.com" })
  endpoint: string;

  @doc("The OAuth client ID")
  @sample(#{ clientId: "your-client-id" })
  clientId: string;

  @doc("The OAuth client secret")
  @sample(#{ clientSecret: "your-client-secret" })
  clientSecret: string;

  @doc("The OAuth token endpoint URL")
  @sample(#{
    tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  })
  tokenUrl: string;

  @doc("OAuth scopes to request")
  @sample(#{ scopes: #["https://cognitiveservices.azure.com/.default"] })
  scopes?: string[];
}
