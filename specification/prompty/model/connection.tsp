import "@prompty/emitter";

namespace Prompty.Core {
  alias ConnectionType = "key" | "oauth" | "reference" | "foundry" | string;
  alias Authority = "user" | "agent" | "system" | string;

  /**
   * Connection configuration for AI agents.
   * `provider`, `kind`, and `endpoint` are required properties here,
   * but this section can accept additional via options.
   */
  @abstract
  @discriminator("kind")
  model Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "oauth" })
    kind: ConnectionType;

    @doc("The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')")
    @sample(#{ authority: "system" })
    authority: Authority = "system";

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
   * Generic connection configuration for AI services.
   */
  model GenericConnection extends Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    kind: "*";

    @doc("Additional options for the connection")
    options?: Record<unknown> = #{};
  }

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
  }

  /**
   * Connection configuration for AI services using API keys.
   */
  model KeyConnection extends Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "key" })
    kind: "key";

    @doc("The endpoint URL for the AI service")
    @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
    endpoint: string;

    @doc("The API key for authenticating with the AI service")
    @sample(#{ key: "your-api-key" })
    key: string;
  }

  /**
   * Connection configuration for AI services using OAuth authentication.
   */
  model OAuthConnection extends Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "oauth" })
    kind: "oauth";

    @doc("The endpoint URL for the AI service")
    @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
    endpoint: string;

    @doc("The OAuth client ID for authenticating with the AI service")
    @sample(#{ clientId: "your-client-id" })
    clientId: string;

    @doc("The OAuth client secret for authenticating with the AI service")
    @sample(#{ clientSecret: "your-client-secret" })
    clientSecret: string;

    @doc("The OAuth token URL for obtaining access tokens")
    @sample(#{
      tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    })
    tokenUrl: string;

    @doc("The scopes required for the OAuth token")
    @sample(#{ scopes: #["https://cognitiveservices.azure.com/.default"] })
    scopes: string[];
  }

  model FoundryConnection extends Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "foundry" })
    kind: "foundry";

    @doc("The Foundry endpoint URL for the AI service")
    @sample(#{ type: "index" })
    type: string;

    @doc("The Foundry connection name")
    @sample(#{ name: "my-foundry-connection" })
    name: string;

    @doc("The Foundry project name")
    @sample(#{ project: "my-foundry-project" })
    project: string;
  }
}
