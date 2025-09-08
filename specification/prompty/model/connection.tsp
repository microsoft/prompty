import "@prompty/emitter";

namespace Prompty.Core {
  alias ConnectionType = "key" | "oauth" | "named" | string;
  alias Authority = "user" | "agent" | "system" | string;

  /**
   * Connection configuration for AI agents.
   * `provider`, `kind`, and `endpoint` are required properties here,
   * but this section can accept additional via options.
   */
  @discriminator("kind")
  model Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "key" })
    kind: ConnectionType;

    @doc("The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')")
    @sample(#{ authority: "system" })
    authority: Authority = "system";

    @doc("Additional options for the connection")
    options?: Record<unknown> = #{};
  }

  /**
   * Connection configuration for AI services using named connections.
   */
  model NamedConnection extends Connection {
    @doc("The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ kind: "named" })
    kind: "named";

    @doc("The name of the connection")
    @sample(#{ name: "my-named-connection" })
    name: string;

    @doc("Additional options for the named connection")
    options?: Record<unknown> = #{};
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
}
