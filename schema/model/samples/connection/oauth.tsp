// Named sample constants for connection/oauth.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const OAuthConnectionKindSample = #{ kind: "oauth" };

const OAuthConnectionEndpointSample = #{ endpoint: "https://api.example.com" };

const OAuthConnectionClientIdSample = #{ clientId: "your-client-id" };

const OAuthConnectionClientSecretSample = #{
  clientSecret: "your-client-secret",
};

const OAuthConnectionTokenUrlSample = #{
  tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
};

const OAuthConnectionScopesSample = #{
  scopes: #["https://cognitiveservices.azure.com/.default"],
};
