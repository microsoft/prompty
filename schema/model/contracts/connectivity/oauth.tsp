import "@typra/emitter";
import "./connection.tsp";

using Prompty.Conformance.Samples;
namespace Prompty.Contracts.Connectivity;

/**
 * Connection configuration using OAuth 2.0 client credentials.
 * Useful for tools and services that require OAuth authentication,
 * such as MCP servers, OpenAPI endpoints, or other REST APIs.
 */
model OAuthConnection extends Connection {
  @doc("The connection kind for OAuth authentication")
  @sample(OAuthConnectionKindSample)
  kind: "oauth";

  @doc("The endpoint URL for the service")
  @sample(OAuthConnectionEndpointSample)
  endpoint: string;

  @doc("The OAuth client ID")
  @sample(OAuthConnectionClientIdSample)
  clientId: string;

  @doc("The OAuth client secret")
  @sample(OAuthConnectionClientSecretSample)
  clientSecret: string;

  @doc("The OAuth token endpoint URL")
  @sample(OAuthConnectionTokenUrlSample)
  tokenUrl: string;

  @doc("OAuth scopes to request")
  @sample(OAuthConnectionScopesSample)
  scopes?: string[];
}
