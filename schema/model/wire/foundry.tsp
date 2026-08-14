import "@typra/emitter";
import "../connection/oauth-flow.tsp";
import "../model/discovery.tsp";
import "../model/resource-discovery.tsp";

using Prompty;
using Prompty.Contracts.Connectivity;
using Prompty.Contracts.Models;

// OAuth contracts → Microsoft Entra OAuth response field names.
@@knownAs(OAuthToken.accessToken, "foundry", "access_token");
@@knownAs(OAuthToken.tokenType, "foundry", "token_type");
@@knownAs(OAuthToken.expiresIn, "foundry", "expires_in");
@@knownAs(OAuthToken.refreshToken, "foundry", "refresh_token");
@@knownAs(OAuthToken.scope, "foundry", "scope");

@@knownAs(DeviceAuthorization.deviceCode, "foundry", "device_code");
@@knownAs(DeviceAuthorization.userCode, "foundry", "user_code");
@@knownAs(DeviceAuthorization.verificationUri, "foundry", "verification_uri");
@@knownAs(DeviceAuthorization.expiresIn, "foundry", "expires_in");
@@knownAs(DeviceAuthorization.interval, "foundry", "interval");
@@knownAs(DeviceAuthorization.message, "foundry", "message");

@@knownAs(AuthorizationCodeFlow.authUrl, "foundry", "auth_url");
@@knownAs(AuthorizationCodeFlow.codeVerifier, "foundry", "code_verifier");

// Resource discovery contracts → Foundry host wire names.
@@knownAs(SubscriptionInfo.subscriptionId, "foundry", "subscription_id");
@@knownAs(SubscriptionInfo.displayName, "foundry", "display_name");
@@knownAs(SubscriptionInfo.state, "foundry", "state");

@@knownAs(AiResourceInfo.name, "foundry", "name");
@@knownAs(AiResourceInfo.kind, "foundry", "kind");
@@knownAs(AiResourceInfo.endpoint, "foundry", "endpoint");
@@knownAs(AiResourceInfo.location, "foundry", "location");
@@knownAs(AiResourceInfo.resourceGroup, "foundry", "resource_group");
@@knownAs(AiResourceInfo.serviceUrl, "foundry", "foundry_url");

@@knownAs(ProjectInfo.name, "foundry", "name");
@@knownAs(ProjectInfo.displayName, "foundry", "display_name");
@@knownAs(ProjectInfo.endpoint, "foundry", "endpoint");
