package com.microsoft.prompty.anthropic;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Environment;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Prompty;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Covers how a prompt's connection turns into an addressed, authenticated request.
 *
 * <p>Everything here happens before a byte is sent, and getting it wrong produces either a 404
 * against a plausible-looking URL or a 401 that reads like a bad key — both of which are far harder
 * to diagnose from a live call than from a test.
 */
class AnthropicExecutorTest {

  private final AnthropicExecutor executor = new AnthropicExecutor();

  @AfterEach
  void clearEnvironment() {
    Environment.clear("ANTHROPIC_API_KEY");
    Environment.clear("ANTHROPIC_BASE_URL");
  }

  private static Prompty agent(Map<String, Object> model) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", model);
    return Prompty.load(data, new LoadContext());
  }

  private static Prompty agentWithConnection(Map<String, Object> connection) {
    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", "claude-3");
    model.put("provider", "anthropic");
    if (connection != null) {
      model.put("connection", connection);
    }
    return agent(model);
  }

  @Test
  void theDefaultEndpointIsUsedWhenTheConnectionNamesNone() {
    assertEquals(
        "https://api.anthropic.com/v1/messages", executor.buildUrl(agentWithConnection(null)));
  }

  @Test
  void anEnvironmentBaseUrlOverridesTheDefault() {
    Environment.set("ANTHROPIC_BASE_URL", "https://proxy.internal");
    assertEquals("https://proxy.internal/v1/messages", executor.buildUrl(agentWithConnection(null)));
  }

  @Test
  void aConnectionEndpointWinsOverTheEnvironment() {
    Environment.set("ANTHROPIC_BASE_URL", "https://proxy.internal");
    Prompty agent =
        agentWithConnection(
            Map.of("kind", "key", "endpoint", "https://declared.example", "apiKey", "k"));
    assertEquals("https://declared.example/v1/messages", executor.buildUrl(agent));
  }

  @Test
  void anEndpointThatAlreadyNamesTheVersionIsNotVersionedTwice() {
    Prompty agent = agentWithConnection(Map.of("kind", "anonymous", "endpoint", "https://proxy/v1"));
    // A proxy base is commonly written with the version on it; appending another yields /v1/v1.
    assertEquals("https://proxy/v1/messages", executor.buildUrl(agent));
  }

  @Test
  void aTrailingSlashDoesNotProduceADoubledSeparator() {
    Prompty agent = agentWithConnection(Map.of("kind", "anonymous", "endpoint", "https://proxy/"));
    assertEquals("https://proxy/v1/messages", executor.buildUrl(agent));
  }

  @Test
  void severalTrailingSlashesAreAllRemoved() {
    // Endpoints get pasted from consoles; leaving `https://proxy//v1/messages` behind is routed
    // differently by some gateways and rejected outright by others.
    Prompty agent = agentWithConnection(Map.of("kind", "anonymous", "endpoint", "https://proxy///"));
    assertEquals("https://proxy/v1/messages", executor.buildUrl(agent));
  }

  @Test
  void theKeyOnTheConnectionIsPreferredOverTheEnvironment() {
    Environment.set("ANTHROPIC_API_KEY", "from-env");
    Prompty agent = agentWithConnection(Map.of("kind", "key", "apiKey", "from-connection"));
    assertEquals("from-connection", executor.apiKey(agent));
  }

  @Test
  void theEnvironmentSuppliesTheKeyWhenTheConnectionDoesNot() {
    Environment.set("ANTHROPIC_API_KEY", "from-env");
    assertEquals("from-env", executor.apiKey(agentWithConnection(null)));
  }

  @Test
  void aMissingKeyFailsWithAMessageThatNamesBothPlacesToPutOne() {
    // Masked rather than left to chance: a machine that exports ANTHROPIC_API_KEY for live runs
    // would otherwise satisfy the lookup and leave no absence to assert on.
    Environment.mask("ANTHROPIC_API_KEY");
    InvokerException failure =
        assertThrows(InvokerException.class, () -> executor.apiKey(agentWithConnection(null)));
    assertTrue(failure.getMessage().contains("ANTHROPIC_API_KEY"));
    assertTrue(failure.getMessage().contains("connection.apiKey"));
  }

  @Test
  void requestsCarryAnApiKeyHeaderAndAPinnedApiVersion() {
    Environment.set("ANTHROPIC_API_KEY", "sk-test");
    Map<String, String> headers = executor.authHeaders(agentWithConnection(null));

    // Anthropic authenticates with x-api-key, not a bearer token, and pins wire-format changes to
    // the version header — omitting it opts the client into whatever the API defaults to.
    assertEquals("sk-test", headers.get("x-api-key"));
    assertEquals(Wire.ANTHROPIC_VERSION, headers.get("anthropic-version"));
  }

  @Test
  void chatAndAgentBothBuildAMessagesRequest() {
    for (String apiType : List.of("chat", "agent")) {
      Prompty agent =
          agent(Map.of("id", "claude-3", "provider", "anthropic", "apiType", apiType));
      assertEquals("claude-3", executor.buildArgs(agent, List.of()).get("model"));
    }
  }

  @Test
  void anApiTypeAnthropicDoesNotOfferIsRejectedBeforeSending() {
    Prompty agent =
        agent(Map.of("id", "claude-3", "provider", "anthropic", "apiType", "embedding"));
    // Failing here names the real problem; letting it through produces a 404 on a URL that looks
    // correct.
    InvokerException failure =
        assertThrows(InvokerException.class, () -> executor.buildArgs(agent, List.of()));
    assertTrue(failure.getMessage().contains("embedding"));
  }
}
