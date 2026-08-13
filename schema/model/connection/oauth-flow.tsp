import "@typra/emitter";

namespace Prompty;

/** Provider-neutral OAuth token material returned by an authorization server. */
model OAuthToken {
  @doc("The bearer access token")
  accessToken: string;

  @doc("The token type, typically Bearer")
  tokenType: string;

  @doc("Lifetime of the access token in seconds")
  expiresIn: int64;

  @doc("Refresh token when offline access was granted")
  @sample(OAuthTokenRefreshTokenSample)
  refreshToken?: string;

  @doc("Scopes granted by the authorization server")
  @sample(OAuthTokenScopeSample)
  scope?: string;
}

/** Provider-neutral device authorization challenge shown to a user. */
model DeviceAuthorization {
  @doc("The device code used when polling the token endpoint")
  deviceCode: string;

  @doc("The short code the user enters at the verification URI")
  userCode: string;

  @doc("The URI where the user authorizes the device")
  verificationUri: string;

  @doc("Lifetime of the device authorization in seconds")
  expiresIn: int64;

  @doc("Minimum polling interval in seconds")
  interval: int64;

  @doc("Human-readable authorization instructions")
  message: string = "";
}

/** Provider-neutral initialization result for an authorization-code flow. */
model AuthorizationCodeFlow {
  @doc("The authorization URL the host opens for the user")
  authUrl: string;

  @doc("The PKCE verifier retained by the host for token exchange")
  codeVerifier: string;
}
