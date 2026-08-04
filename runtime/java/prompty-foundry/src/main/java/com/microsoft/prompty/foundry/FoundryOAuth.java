package com.microsoft.prompty.foundry;

import com.microsoft.prompty.Http;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.AuthorizationCodeFlow;
import com.microsoft.prompty.model.DeviceAuthorization;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.OAuthToken;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Interactive Azure sign-in flows: device authorization, authorization code with PKCE, and refresh.
 *
 * <p>{@link FoundryAuth} covers the non-interactive credentials — an API key, a bearer token from
 * the environment. Those assume a credential already exists. This class is how one is obtained when
 * a human has to approve it, which is the usual case for a developer running locally against their
 * own Azure tenant.
 *
 * <p><b>What this owns, and what it does not.</b> This is the protocol only: PKCE generation,
 * authorize-URL construction, the device-code request and poll state machine, code exchange, and
 * refresh. Opening a browser, binding a loopback listener to receive the redirect, serving the
 * post-redirect page, and storing the resulting tokens are all host concerns. Keeping the split here
 * means the same protocol serves a CLI, an editor extension, and a test without any of them
 * inheriting the others' assumptions about how a user is present.
 *
 * <p>Endpoints, scopes, and the default client id are Azure-concrete deliberately: interactive OAuth
 * has exactly one provider today. If a second ever appears, lift them into a configuration value
 * rather than generalising speculatively now.
 */
public final class FoundryOAuth {

  /** The Azure CLI public client id, used when the caller supplies none. */
  public static final String DEFAULT_CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2";

  /**
   * Default scope for Foundry and Azure OpenAI access.
   *
   * <p>{@code offline_access} is included so the response carries a refresh token; without it the
   * user would have to sign in again the moment the access token expires.
   */
  public static final String AZURE_OPENAI_SCOPE = "https://ai.azure.com/.default offline_access";

  /** Default scope for Azure Resource Manager access, used by {@link FoundryArm}. */
  public static final String AZURE_MANAGEMENT_SCOPE =
      "https://management.azure.com/.default offline_access";

  /** Tenant used when the caller supplies an empty one. */
  static final String DEFAULT_TENANT = "organizations";

  /** RFC 8628 mandates a poll interval of at least five seconds. */
  static final long MIN_POLL_INTERVAL_SECONDS = 5;

  /** RFC 7636 allows 43..128; 64 is comfortably inside that and a round number of bytes to read. */
  static final int PKCE_VERIFIER_LENGTH = 64;

  private static final String UNRESERVED =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  private static final SecureRandom RANDOM = new SecureRandom();

  private static final String PROVIDER = "azure-oauth";

  private FoundryOAuth() {}

  /**
   * Build the authorize URL for an authorization-code flow with PKCE.
   *
   * <p>Performs no I/O. The returned value carries both the URL to send the user to and the verifier
   * that must be presented later at {@link #exchangeCodeForToken}; they are generated together
   * because a challenge is meaningless without the verifier it was derived from.
   *
   * @param tenantId the directory to sign in against; empty means {@value #DEFAULT_TENANT}
   * @param clientId the application id, or {@code null} for {@value #DEFAULT_CLIENT_ID}
   * @param scope the requested scope, or {@code null} for {@link #AZURE_OPENAI_SCOPE}
   * @param redirectUri where the provider should return the user, chosen by the host
   */
  public static AuthorizationCodeFlow buildAuthCodeUrl(
      String tenantId, String clientId, String scope, String redirectUri) {
    Pkce pkce = generatePkce();

    Map<String, String> query = new LinkedHashMap<>();
    query.put("client_id", clientIdOrDefault(clientId));
    query.put("response_type", "code");
    query.put("redirect_uri", redirectUri);
    query.put("response_mode", "query");
    query.put("scope", scopeOrDefault(scope));
    query.put("code_challenge", pkce.challenge());
    query.put("code_challenge_method", "S256");

    AuthorizationCodeFlow flow = new AuthorizationCodeFlow();
    flow.authUrl = authorizeUrl(tenantId) + "?" + Http.encodeForm(query);
    flow.codeVerifier = pkce.verifier();
    return flow;
  }

  /**
   * Request a device authorization code (RFC 8628 §3.1).
   *
   * <p>The returned value carries the code to display to the user and the interval the provider
   * wants between polls; feed both to {@link #pollForToken}.
   */
  public static DeviceAuthorization requestDeviceCode(
      String tenantId, String clientId, String scope) {
    Map<String, String> form = new LinkedHashMap<>();
    form.put("client_id", clientIdOrDefault(clientId));
    form.put("scope", scopeOrDefault(scope));

    Http.FormResult result = Http.postForm(PROVIDER, deviceCodeUrl(tenantId), form);
    if (!result.isSuccess()) {
      throw InvokerException.execute(
          "device code request failed (HTTP " + result.status() + "): " + result.body());
    }
    return parseDeviceAuthorization(result.body());
  }

  /**
   * Poll the token endpoint until the user approves the device or the flow times out (RFC 8628
   * §3.4–3.5).
   *
   * <p>The interval is floored at {@value #MIN_POLL_INTERVAL_SECONDS} seconds and grows by five more
   * whenever the provider answers {@code slow_down}; polling faster than asked risks being throttled
   * outright. The scope is deliberately not resent — it was fixed when the device code was issued.
   */
  public static OAuthToken pollForToken(
      String tenantId, String deviceCode, long intervalSeconds, long timeoutSeconds, String clientId) {
    return pollForToken(
        tenantId,
        deviceCode,
        intervalSeconds,
        timeoutSeconds,
        clientId,
        (url, form) -> Http.postForm(PROVIDER, url, form),
        FoundryOAuth::sleepSeconds,
        System::nanoTime);
  }

  /**
   * The poll loop with its transport, sleep, and clock supplied.
   *
   * <p>Split out so the state machine — the pending/slow-down/expired branches and the interval
   * floor — can be tested in microseconds instead of minutes, and without reaching Azure.
   */
  static OAuthToken pollForToken(
      String tenantId,
      String deviceCode,
      long intervalSeconds,
      long timeoutSeconds,
      String clientId,
      TokenEndpoint endpoint,
      Sleeper sleeper,
      Clock clock) {
    long interval = Math.max(intervalSeconds, MIN_POLL_INTERVAL_SECONDS);
    long deadline = clock.nanoTime() + timeoutSeconds * 1_000_000_000L;
    String resolvedClientId = clientIdOrDefault(clientId);
    String url = tokenUrl(tenantId);

    while (true) {
      if (clock.nanoTime() >= deadline) {
        throw InvokerException.execute("device code authorization timed out");
      }
      sleeper.sleep(interval);

      Map<String, String> form = new LinkedHashMap<>();
      form.put("client_id", resolvedClientId);
      form.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
      form.put("device_code", deviceCode);

      Http.FormResult result = endpoint.post(url, form);
      if (result.isSuccess()) {
        return parseToken(result.body());
      }

      String error = errorCode(result);
      switch (error) {
        case "authorization_pending" -> {
          // The user simply has not finished yet; this is the expected steady state.
        }
        case "slow_down" -> interval += 5;
        case "expired_token" ->
            throw InvokerException.execute("device code expired before authorization");
        default -> throw InvokerException.execute("device code authorization failed: " + error);
      }
    }
  }

  /** Exchange an authorization code for a token (RFC 6749 §4.1.3, with PKCE). */
  public static OAuthToken exchangeCodeForToken(
      String tenantId,
      String code,
      String redirectUri,
      String codeVerifier,
      String clientId,
      String scope) {
    Map<String, String> form = new LinkedHashMap<>();
    form.put("client_id", clientIdOrDefault(clientId));
    form.put("grant_type", "authorization_code");
    form.put("code", code);
    form.put("redirect_uri", redirectUri);
    form.put("code_verifier", codeVerifier);
    form.put("scope", scopeOrDefault(scope));
    return postToken(tenantId, form);
  }

  /** Exchange a refresh token for a fresh access token (RFC 6749 §6). */
  public static OAuthToken refreshToken(
      String tenantId, String refreshToken, String clientId, String scope) {
    Map<String, String> form = new LinkedHashMap<>();
    form.put("client_id", clientIdOrDefault(clientId));
    form.put("grant_type", "refresh_token");
    form.put("refresh_token", refreshToken);
    form.put("scope", scopeOrDefault(scope));
    return postToken(tenantId, form);
  }

  private static OAuthToken postToken(String tenantId, Map<String, String> form) {
    Http.FormResult result = Http.postForm(PROVIDER, tokenUrl(tenantId), form);
    if (!result.isSuccess()) {
      throw InvokerException.execute(
          "token request failed (HTTP " + result.status() + "): " + result.body());
    }
    return parseToken(result.body());
  }

  /** Read the OAuth error code from a failed token response (RFC 6749 §5.2). */
  private static String errorCode(Http.FormResult result) {
    // The body is reported only by way of the parser's complaint, never verbatim. A token endpoint
    // answers a failed poll with an OAuth error rather than a credential, so this is not a leak
    // either way — but echoing a whole response body into an exception is a habit worth not
    // forming on a code path that handles tokens.
    Object parsed;
    try {
      parsed = com.microsoft.prompty.model.TypraJson.parse(result.body());
    } catch (RuntimeException e) {
      throw parseFailure(result.status(), e.getMessage());
    }
    if (parsed instanceof Map<?, ?> map && map.get("error") instanceof String code) {
      return code;
    }
    // Parsed cleanly but carries no error code: the service has given a final answer this code
    // cannot act on. Continuing would poll until the deadline against a request that will never
    // succeed, so it is surfaced instead.
    throw parseFailure(result.status(), "missing field `error`");
  }

  private static InvokerException parseFailure(int status, String reason) {
    return InvokerException.execute(
        "failed to parse token error response (HTTP " + status + "): " + reason);
  }

  // ---------------------------------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------------------------------

  /**
   * The OAuth wire is snake_case; the generated model is camelCase.
   *
   * <p>Renaming through a load hook rather than a hand-written mapper means the model stays the
   * single source of truth for what these values are — a field added upstream arrives here without
   * this class changing.
   */
  private static LoadContext wireContext() {
    return new LoadContext(
        value -> {
          if (!(value instanceof Map<?, ?> source)) {
            return value;
          }
          Map<String, Object> renamed = new LinkedHashMap<>();
          source.forEach((key, item) -> renamed.put(String.valueOf(key), item));
          for (String[] pair :
              new String[][] {
                {"access_token", "accessToken"},
                {"token_type", "tokenType"},
                {"expires_in", "expiresIn"},
                {"refresh_token", "refreshToken"},
                {"device_code", "deviceCode"},
                {"user_code", "userCode"},
                {"verification_uri", "verificationUri"},
              }) {
            if (renamed.containsKey(pair[0])) {
              renamed.put(pair[1], renamed.remove(pair[0]));
            }
          }
          return renamed;
        },
        null);
  }

  static OAuthToken parseToken(String body) {
    Map<String, Object> value = asObject(body);
    requireString(value, "access_token");
    requireString(value, "token_type");
    requireNonNegative(value, "expires_in");
    return OAuthToken.load(value, wireContext());
  }

  static DeviceAuthorization parseDeviceAuthorization(String body) {
    Map<String, Object> value = asObject(body);
    requireString(value, "device_code");
    requireString(value, "user_code");
    requireString(value, "verification_uri");
    requireNonNegative(value, "expires_in");
    requireNonNegative(value, "interval");
    return DeviceAuthorization.load(value, wireContext());
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asObject(String body) {
    Object parsed;
    try {
      parsed = com.microsoft.prompty.model.TypraJson.parse(body);
    } catch (RuntimeException e) {
      throw InvokerException.execute("failed to parse response: " + e.getMessage(), e);
    }
    if (!(parsed instanceof Map<?, ?>)) {
      throw InvokerException.execute("failed to parse response: expected a JSON object");
    }
    return (Map<String, Object>) parsed;
  }

  private static void requireString(Map<String, Object> value, String field) {
    if (!(value.get(field) instanceof String text) || text.isEmpty()) {
      throw InvokerException.execute(
          "missing or invalid field '" + field + "'; expected a non-empty string");
    }
  }

  private static void requireNonNegative(Map<String, Object> value, String field) {
    if (!(value.get(field) instanceof Number number) || number.longValue() < 0) {
      throw InvokerException.execute(
          "missing or invalid field '" + field + "'; expected a non-negative integer");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // PKCE
  // ---------------------------------------------------------------------------------------------

  /** A PKCE verifier and the S256 challenge derived from it (RFC 7636). */
  record Pkce(String verifier, String challenge) {}

  static Pkce generatePkce() {
    StringBuilder verifier = new StringBuilder(PKCE_VERIFIER_LENGTH);
    for (int i = 0; i < PKCE_VERIFIER_LENGTH; i++) {
      verifier.append(UNRESERVED.charAt(RANDOM.nextInt(UNRESERVED.length())));
    }
    return new Pkce(verifier.toString(), challengeFor(verifier.toString()));
  }

  static String challengeFor(String verifier) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    } catch (NoSuchAlgorithmException e) {
      // SHA-256 is required of every Java platform, so this cannot happen on a conforming runtime.
      throw new IllegalStateException("SHA-256 is unavailable", e);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // URLs and defaults
  // ---------------------------------------------------------------------------------------------

  static String tenantOrDefault(String tenantId) {
    return tenantId == null || tenantId.isEmpty() ? DEFAULT_TENANT : tenantId;
  }

  private static String clientIdOrDefault(String clientId) {
    return clientId == null || clientId.isEmpty() ? DEFAULT_CLIENT_ID : clientId;
  }

  private static String scopeOrDefault(String scope) {
    return scope == null || scope.isEmpty() ? AZURE_OPENAI_SCOPE : scope;
  }

  static String deviceCodeUrl(String tenantId) {
    return "https://login.microsoftonline.com/" + tenantOrDefault(tenantId) + "/oauth2/v2.0/devicecode";
  }

  static String tokenUrl(String tenantId) {
    return "https://login.microsoftonline.com/" + tenantOrDefault(tenantId) + "/oauth2/v2.0/token";
  }

  static String authorizeUrl(String tenantId) {
    return "https://login.microsoftonline.com/" + tenantOrDefault(tenantId) + "/oauth2/v2.0/authorize";
  }

  private static void sleepSeconds(long seconds) {
    try {
      Thread.sleep(seconds * 1000L);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw InvokerException.cancelled("Interrupted while awaiting device code authorization");
    }
  }

  /** The token endpoint, as the poll loop sees it. */
  @FunctionalInterface
  interface TokenEndpoint {
    Http.FormResult post(String url, Map<String, String> form);
  }

  /** The delay between polls, as the poll loop sees it. */
  @FunctionalInterface
  interface Sleeper {
    void sleep(long seconds);
  }

  /** The passage of time, as the poll loop sees it. */
  @FunctionalInterface
  interface Clock {
    long nanoTime();
  }
}
