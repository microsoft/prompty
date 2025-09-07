import "@prompty/emitter";

namespace Prompty.Core {
  alias ConnectionType = "key" | "oauth" | "agent" | string;

  /**
   * Connection configuration for AI agents.
   * `provider`, `type`, and `endpoint` are required properties here,
   * but this section can accept additional via options.
   */
  model Connection {
    @doc("The Authentication type for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ authType: "key" })
    authType: ConnectionType;

    @doc("The endpoint URL for the AI service")
    @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
    endpoint: string;

    @doc("Additional options for the connection")
    options?: Record<unknown> = #{};
  }

  /**
   * Connection configuration for AI services using API keys.
   */
  model KeyConnection extends Connection {
    @doc("The Authentication type for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ authType: "key" })
    authType: "key";

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
    @doc("The Authentication type for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ authType: "oauth" })
    authType: "oauth";

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
    @sample(#{ tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token" })
    tokenUrl: string;

    @doc("The scopes required for the OAuth token")
    @sample(#{ scopes: #["https://cognitiveservices.azure.com/.default"] })
    scopes: string[];
  }
}
