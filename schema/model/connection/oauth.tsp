import "@typra/emitter";
import "./connection.tsp";

namespace Prompty;

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
