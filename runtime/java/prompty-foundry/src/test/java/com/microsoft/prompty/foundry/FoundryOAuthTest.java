package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Http;
import com.microsoft.prompty.model.AuthorizationCodeFlow;
import com.microsoft.prompty.model.DeviceAuthorization;
import com.microsoft.prompty.model.OAuthToken;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Covers the interactive sign-in protocol: PKCE, authorize-URL construction, response validation,
 * and the device-code poll state machine.
 *
 * <p>The poll loop is driven through its injected transport and clock rather than over the network,
 * so the branches that only appear during a real sign-in — a user who has not answered yet, a
 * provider asking to be polled less often, an expired code — are exercised deterministically and in
 * microseconds.
 */
@DisplayName("Foundry OAuth")
final class FoundryOAuthTest {

  @Nested
  @DisplayName("PKCE")
  class Pkce {

    @Test
    void theVerifierUsesOnlyCharactersTheSpecAllows() {
      FoundryOAuth.Pkce pkce = FoundryOAuth.generatePkce();
      assertEquals(FoundryOAuth.PKCE_VERIFIER_LENGTH, pkce.verifier().length());
      for (char c : pkce.verifier().toCharArray()) {
        boolean unreserved =
            Character.isLetterOrDigit(c) && c < 128 || c == '-' || c == '.' || c == '_' || c == '~';
        assertTrue(unreserved, "verifier must use RFC 7636 unreserved characters but had: " + c);
      }
    }

    @Test
    void theChallengeIsTheBase64UrlSha256OfTheVerifier() throws Exception {
      FoundryOAuth.Pkce pkce = FoundryOAuth.generatePkce();
      byte[] digest =
          MessageDigest.getInstance("SHA-256")
              .digest(pkce.verifier().getBytes(StandardCharsets.US_ASCII));
      String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
      assertEquals(expected, pkce.challenge());
    }

    @Test
    void theChallengeIsUrlSafeAndUnpadded() {
      String challenge = FoundryOAuth.generatePkce().challenge();
      // SHA-256 is 32 bytes, which is 43 base64 characters once padding is dropped.
      assertEquals(43, challenge.length());
      assertFalse(challenge.contains("="), "padding would be rejected in a URL");
      assertFalse(challenge.contains("+"), "'+' means a space in a query string");
      assertFalse(challenge.contains("/"), "'/' would be read as a path separator");
    }

    @Test
    void everyPairIsFresh() {
      FoundryOAuth.Pkce first = FoundryOAuth.generatePkce();
      FoundryOAuth.Pkce second = FoundryOAuth.generatePkce();
      assertNotEquals(first.verifier(), second.verifier());
      assertNotEquals(first.challenge(), second.challenge());
    }

    @Test
    void aKnownVerifierProducesTheChallengeFromTheSpec() {
      // RFC 7636 appendix B's worked example, which pins the digest and the encoding together.
      assertEquals(
          "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          FoundryOAuth.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }
  }

  @Nested
  @DisplayName("authorize URL")
  class AuthorizeUrl {

    @Test
    void carriesEveryParameterTheCodeFlowNeeds() {
      AuthorizationCodeFlow flow =
          FoundryOAuth.buildAuthCodeUrl("my-tenant", null, null, "http://127.0.0.1:5000");
      URI url = URI.create(flow.authUrl);

      assertEquals("login.microsoftonline.com", url.getHost());
      assertEquals("/my-tenant/oauth2/v2.0/authorize", url.getPath());

      Map<String, String> query = queryOf(flow.authUrl);
      assertEquals(FoundryOAuth.DEFAULT_CLIENT_ID, query.get("client_id"));
      assertEquals("code", query.get("response_type"));
      assertEquals("http://127.0.0.1:5000", query.get("redirect_uri"));
      assertEquals("query", query.get("response_mode"));
      assertEquals(FoundryOAuth.AZURE_OPENAI_SCOPE, query.get("scope"));
      assertEquals("S256", query.get("code_challenge_method"));
    }

    @Test
    void theChallengeInTheUrlMatchesTheVerifierHandedBack() {
      AuthorizationCodeFlow flow =
          FoundryOAuth.buildAuthCodeUrl("t", null, null, "http://127.0.0.1:1");
      // If these ever diverged the provider would reject the exchange, and only at the very last
      // step of a sign-in the user already sat through.
      assertEquals(
          FoundryOAuth.challengeFor(flow.codeVerifier), queryOf(flow.authUrl).get("code_challenge"));
    }

    @Test
    void anEmptyTenantFallsBackToTheOrganizationsEndpoint() {
      AuthorizationCodeFlow flow =
          FoundryOAuth.buildAuthCodeUrl("", "custom-client", "custom-scope", "http://127.0.0.1:1");
      assertEquals("/organizations/oauth2/v2.0/authorize", URI.create(flow.authUrl).getPath());

      Map<String, String> query = queryOf(flow.authUrl);
      assertEquals("custom-client", query.get("client_id"));
      assertEquals("custom-scope", query.get("scope"));
    }

    @Test
    void theScopeSeparatorSurvivesEncoding() {
      // The default scope contains a space; if it were dropped or mangled the request would ask for
      // a single nonsensical scope and silently come back without a refresh token.
      AuthorizationCodeFlow flow =
          FoundryOAuth.buildAuthCodeUrl("t", null, null, "http://127.0.0.1:1");
      assertTrue(
          flow.authUrl.contains("scope=https%3A%2F%2Fai.azure.com%2F.default+offline_access"),
          "the space must survive as '+' but the URL was: " + flow.authUrl);
      assertEquals(FoundryOAuth.AZURE_OPENAI_SCOPE, queryOf(flow.authUrl).get("scope"));
    }
  }

  @Nested
  @DisplayName("endpoint URLs")
  class EndpointUrls {

    @Test
    void applyTheTenantDefault() {
      assertEquals(
          "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode",
          FoundryOAuth.deviceCodeUrl(""));
      assertEquals(
          "https://login.microsoftonline.com/contoso/oauth2/v2.0/token",
          FoundryOAuth.tokenUrl("contoso"));
      assertEquals(
          "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
          FoundryOAuth.authorizeUrl(null));
    }
  }

  @Nested
  @DisplayName("response parsing")
  class ResponseParsing {

    @Test
    void aTokenLoadsWithOnlyTheRequiredFields() {
      OAuthToken token =
          FoundryOAuth.parseToken(
              "{\"access_token\":\"abc\",\"token_type\":\"Bearer\",\"expires_in\":3600}");
      assertEquals("abc", token.accessToken);
      assertEquals("Bearer", token.tokenType);
      assertEquals(3600L, token.expiresIn);
      assertNull(token.refreshToken);
      assertNull(token.scope);
    }

    @Test
    void aTokenCarriesItsRefreshAndScopeWhenPresent() {
      OAuthToken token =
          FoundryOAuth.parseToken(
              "{\"access_token\":\"a\",\"token_type\":\"Bearer\",\"expires_in\":1,"
                  + "\"refresh_token\":\"r\",\"scope\":\"s\"}");
      assertEquals("r", token.refreshToken);
      assertEquals("s", token.scope);
    }

    @Test
    void aTokenMissingItsAccessTokenIsRejected() {
      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () -> FoundryOAuth.parseToken("{\"token_type\":\"Bearer\",\"expires_in\":3600}"));
      assertTrue(
          String.valueOf(error.getMessage()).contains("access_token"),
          "the error should name the field that was missing: " + error.getMessage());
    }

    @Test
    void aTokenWithAnEmptyAccessTokenIsRejected() {
      // An empty string is not a usable credential, and accepting one would turn an auth failure
      // into a confusing 401 several calls later.
      assertThrows(
          RuntimeException.class,
          () ->
              FoundryOAuth.parseToken(
                  "{\"access_token\":\"\",\"token_type\":\"Bearer\",\"expires_in\":1}"));
    }

    @Test
    void aDeviceAuthorizationLoads() {
      DeviceAuthorization device =
          FoundryOAuth.parseDeviceAuthorization(
              "{\"device_code\":\"dc\",\"user_code\":\"UC\","
                  + "\"verification_uri\":\"https://aka.ms/devicelogin\","
                  + "\"expires_in\":900,\"interval\":5,\"message\":\"go here\"}");
      assertEquals("dc", device.deviceCode);
      assertEquals("UC", device.userCode);
      assertEquals("https://aka.ms/devicelogin", device.verificationUri);
      assertEquals(5L, device.interval);
      assertEquals("go here", device.message);
    }

    @Test
    void aDeviceAuthorizationWithoutAMessageDefaultsToEmpty() {
      DeviceAuthorization device =
          FoundryOAuth.parseDeviceAuthorization(
              "{\"device_code\":\"dc\",\"user_code\":\"UC\",\"verification_uri\":\"u\","
                  + "\"expires_in\":900,\"interval\":5}");
      assertEquals("", device.message);
    }

    @Test
    void aNegativePollIntervalIsRejected() {
      // A negative interval would become a negative sleep and spin the poll loop as fast as the
      // network allows, which is the behaviour the interval exists to prevent.
      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.parseDeviceAuthorization(
                      "{\"device_code\":\"dc\",\"user_code\":\"UC\",\"verification_uri\":\"u\","
                          + "\"expires_in\":900,\"interval\":-1}"));
      assertTrue(
          String.valueOf(error.getMessage()).contains("interval"),
          "the error should name the offending field: " + error.getMessage());
    }

    @Test
    void aNonObjectResponseIsRejected() {
      assertThrows(RuntimeException.class, () -> FoundryOAuth.parseToken("\"not an object\""));
    }
  }

  @Nested
  @DisplayName("device code poll loop")
  class PollLoop {

    @Test
    void returnsTheTokenOnTheFirstSuccessfulPoll() {
      FakeEndpoint endpoint =
          new FakeEndpoint(
              ok("{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_in\":10}"));
      RecordingSleeper sleeper = new RecordingSleeper();

      OAuthToken token =
          FoundryOAuth.pollForToken(
              "t", "dc", 5, 600, null, endpoint, sleeper, new SteadyClock());

      assertEquals("tok", token.accessToken);
      assertEquals(1, endpoint.calls.size());
    }

    @Test
    void keepsWaitingWhileTheUserHasNotAnswered() {
      FakeEndpoint endpoint =
          new FakeEndpoint(
              error(400, "authorization_pending"),
              error(400, "authorization_pending"),
              ok("{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_in\":10}"));
      RecordingSleeper sleeper = new RecordingSleeper();

      OAuthToken token =
          FoundryOAuth.pollForToken(
              "t", "dc", 5, 600, null, endpoint, sleeper, new SteadyClock());

      assertEquals("tok", token.accessToken);
      assertEquals(3, endpoint.calls.size());
      // A pending answer must not change the cadence.
      assertEquals(List.of(5L, 5L, 5L), sleeper.waits);
    }

    @Test
    void backsOffByFiveSecondsWhenAskedToSlowDown() {
      FakeEndpoint endpoint =
          new FakeEndpoint(
              error(400, "slow_down"),
              error(400, "slow_down"),
              ok("{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_in\":10}"));
      RecordingSleeper sleeper = new RecordingSleeper();

      FoundryOAuth.pollForToken("t", "dc", 5, 600, null, endpoint, sleeper, new SteadyClock());

      // Each slow_down adds five seconds, and the increase persists into later polls.
      assertEquals(List.of(5L, 10L, 15L), sleeper.waits);
    }

    @Test
    void neverPollsFasterThanTheProtocolFloor() {
      FakeEndpoint endpoint =
          new FakeEndpoint(
              ok("{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_in\":10}"));
      RecordingSleeper sleeper = new RecordingSleeper();

      // A provider that asks for a one-second cadence still gets the RFC 8628 minimum.
      FoundryOAuth.pollForToken("t", "dc", 1, 600, null, endpoint, sleeper, new SteadyClock());

      assertEquals(List.of(FoundryOAuth.MIN_POLL_INTERVAL_SECONDS), sleeper.waits);
    }

    @Test
    void reportsAnExpiredCodeInTermsTheUserCanActastOn() {
      FakeEndpoint endpoint = new FakeEndpoint(error(400, "expired_token"));

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 600, null, endpoint, new RecordingSleeper(), new SteadyClock()));

      assertTrue(
          String.valueOf(error.getMessage()).contains("expired"),
          "the message should say the code expired: " + error.getMessage());
    }

    @Test
    void surfacesAnUnrecognisedErrorRatherThanLoopingOnIt() {
      FakeEndpoint endpoint = new FakeEndpoint(error(400, "access_denied"));

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 600, null, endpoint, new RecordingSleeper(), new SteadyClock()));

      assertTrue(
          String.valueOf(error.getMessage()).contains("access_denied"),
          "the provider's error code should reach the caller: " + error.getMessage());
    }

    @Test
    void givesUpOnceTheDeadlinePasses() {
      FakeEndpoint endpoint =
          new FakeEndpoint(error(400, "authorization_pending"), error(400, "authorization_pending"));
      // Each poll advances the clock by a minute, so a two-minute budget cannot survive three.
      AdvancingClock clock = new AdvancingClock(60);

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 120, null, endpoint, new RecordingSleeper(), clock));

      assertTrue(
          String.valueOf(error.getMessage()).contains("timed out"),
          "the message should say the flow timed out: " + error.getMessage());
    }

    @Test
    void checksTheDeadlineBeforeTheFirstSleep() {
      // A caller that passes an already-elapsed budget should not be made to wait first.
      FakeEndpoint endpoint = new FakeEndpoint();
      RecordingSleeper sleeper = new RecordingSleeper();

      assertThrows(
          RuntimeException.class,
          () ->
              FoundryOAuth.pollForToken(
                  "t", "dc", 5, 0, null, endpoint, sleeper, new SteadyClock()));

      assertTrue(sleeper.waits.isEmpty(), "no sleep should happen when the budget is already spent");
      assertTrue(endpoint.calls.isEmpty(), "no request should be sent when the budget is spent");
    }

    @Test
    void sendsTheDeviceGrantWithoutResendingTheScope() {
      FakeEndpoint endpoint =
          new FakeEndpoint(
              ok("{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_in\":10}"));

      FoundryOAuth.pollForToken(
          "t", "the-code", 5, 600, "cid", endpoint, new RecordingSleeper(), new SteadyClock());

      Map<String, String> form = endpoint.calls.get(0);
      assertEquals("cid", form.get("client_id"));
      assertEquals("urn:ietf:params:oauth:grant-type:device_code", form.get("grant_type"));
      assertEquals("the-code", form.get("device_code"));
      // The scope was fixed when the device code was issued; resending it is at best redundant.
      assertFalse(form.containsKey("scope"), "the poll must not resend the scope");
    }

    @Test
    void anUnparseableErrorBodyIsReportedRatherThanTreatedAsPending() {
      // Silently continuing here would turn a hard failure into a poll loop that never ends.
      FakeEndpoint endpoint = new FakeEndpoint(new Http.FormResult(500, "<html>gateway error"));

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 600, null, endpoint, new RecordingSleeper(), new SteadyClock()));

      assertTrue(
          String.valueOf(error.getMessage()).contains("500"),
          "the status should reach the caller: " + error.getMessage());
    }

    @Test
    void aWellFormedBodyWithNoErrorCodeIsAlsoReported() {
      // Distinct from the unparseable case: this body is valid JSON, so it gets past the parser and
      // reaches the branch that decides what the failure means. Treating a missing code as "pending"
      // would poll forever against a service that has already given its final answer.
      FakeEndpoint endpoint = new FakeEndpoint(new Http.FormResult(400, "{\"unexpected\":\"shape\"}"));

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 600, null, endpoint, new RecordingSleeper(), new SteadyClock()));

      assertTrue(
          String.valueOf(error.getMessage()).contains("400"),
          "the status should reach the caller: " + error.getMessage());
    }

    @Test
    void aFailureReportDoesNotEchoTheResponseBody() {
      // This runs on a path that handles tokens. A body is reported by way of the parser's
      // complaint about it, never copied out wholesale, so no future response shape can turn this
      // message into a place credentials end up.
      FakeEndpoint endpoint =
          new FakeEndpoint(new Http.FormResult(400, "{\"access_token\":\"do-not-echo-me\"}"));

      RuntimeException error =
          assertThrows(
              RuntimeException.class,
              () ->
                  FoundryOAuth.pollForToken(
                      "t", "dc", 5, 600, null, endpoint, new RecordingSleeper(), new SteadyClock()));

      assertFalse(
          String.valueOf(error.getMessage()).contains("do-not-echo-me"),
          "the body leaked into the message: " + error.getMessage());
    }
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private static Http.FormResult ok(String body) {
    return new Http.FormResult(200, body);
  }

  private static Http.FormResult error(int status, String code) {
    return new Http.FormResult(status, "{\"error\":\"" + code + "\"}");
  }

  private static Map<String, String> queryOf(String url) {
    Map<String, String> pairs = new HashMap<>();
    String query = URI.create(url).getRawQuery();
    if (query == null) {
      return pairs;
    }
    for (String part : query.split("&")) {
      int equals = part.indexOf('=');
      String key = equals < 0 ? part : part.substring(0, equals);
      String value = equals < 0 ? "" : part.substring(equals + 1);
      pairs.put(decode(key), decode(value));
    }
    return pairs;
  }

  private static String decode(String value) {
    return java.net.URLDecoder.decode(value, StandardCharsets.UTF_8);
  }

  /** A token endpoint that replays a fixed script and records what it was sent. */
  private static final class FakeEndpoint implements FoundryOAuth.TokenEndpoint {

    private final Deque<Http.FormResult> responses = new ArrayDeque<>();
    final List<Map<String, String>> calls = new ArrayList<>();

    FakeEndpoint(Http.FormResult... scripted) {
      this.responses.addAll(List.of(scripted));
    }

    @Override
    public Http.FormResult post(String url, Map<String, String> form) {
      calls.add(Map.copyOf(form));
      if (responses.isEmpty()) {
        throw new AssertionError("the poll loop asked for more responses than were scripted");
      }
      return responses.removeFirst();
    }
  }

  /** Records the requested waits instead of performing them. */
  private static final class RecordingSleeper implements FoundryOAuth.Sleeper {

    final List<Long> waits = new ArrayList<>();

    @Override
    public void sleep(long seconds) {
      waits.add(seconds);
    }
  }

  /** A clock that never advances, so only an explicit deadline check can fire. */
  private static final class SteadyClock implements FoundryOAuth.Clock {

    @Override
    public long nanoTime() {
      return 0;
    }
  }

  /** A clock that jumps forward a fixed number of seconds on every reading. */
  private static final class AdvancingClock implements FoundryOAuth.Clock {

    private final long stepSeconds;
    private long readings;

    AdvancingClock(long stepSeconds) {
      this.stepSeconds = stepSeconds;
    }

    @Override
    public long nanoTime() {
      return readings++ * stepSeconds * 1_000_000_000L;
    }
  }
}
