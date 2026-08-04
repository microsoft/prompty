package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.LiveEnv;
import com.microsoft.prompty.Pipeline;
import com.microsoft.prompty.model.Prompty;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * End-to-end coverage against a real Azure AI Foundry deployment.
 *
 * <p>Foundry needs both an endpoint and a credential, and the two arrive by different routes: a
 * classic Azure OpenAI resource uses {@code AZURE_OPENAI_ENDPOINT} plus {@code AZURE_OPENAI_API_KEY},
 * while a Foundry project uses {@code FOUNDRY_PROJECT_ENDPOINT} plus a bearer token in {@code
 * AZURE_INFERENCE_CREDENTIAL} — typically {@code az account get-access-token}. Each test asks only
 * for the pair it needs so a machine holding one style of credential still exercises that path.
 *
 * <p>Method order is pinned because one test deliberately removes a credential. JUnit's default
 * order is an unspecified hash order, so without pinning, whether a later test ran or skipped could
 * change between JVMs — and a skip that looks like "no credential" would really be "a previous test
 * took it away".
 *
 * <p>Excluded from the normal build by the {@code live} tag. Run with {@code -PliveTests}.
 */
@Tag("live")
@DisplayName("live: Foundry")
@TestMethodOrder(MethodOrderer.MethodName.class)
final class FoundryLiveTest {

  @BeforeAll
  static void setUp() {
    LiveEnv.load();
  }

  /** A prompt against a classic Azure OpenAI deployment, addressed by deployment name. */
  private static Prompty azureAgent(String question, Map<String, Object> options) {
    Map<String, Object> connection = new LinkedHashMap<>();
    connection.put("kind", "key");
    connection.put("endpoint", LiveEnv.get("AZURE_OPENAI_ENDPOINT", ""));
    connection.put("apiKey", LiveEnv.get("AZURE_OPENAI_API_KEY", ""));

    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", LiveEnv.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"));
    model.put("provider", "foundry");
    model.put("apiType", "chat");
    model.put("connection", connection);
    model.put("options", options);

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "live-foundry-azure");
    data.put("kind", "prompt");
    data.put("model", model);
    data.put("instructions", "system:\nYou are a helpful assistant. Be very brief.\nuser:\n" + question);
    return Prompty.load(data, new com.microsoft.prompty.model.LoadContext());
  }

  /** A prompt against a Foundry project's inference surface, addressed by model id. */
  private static Prompty foundryAgent(String question, Map<String, Object> options) {
    Map<String, Object> connection = new LinkedHashMap<>();
    connection.put("kind", "foundry");
    connection.put("endpoint", LiveEnv.get("FOUNDRY_PROJECT_ENDPOINT", ""));

    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", LiveEnv.get("FOUNDRY_MODEL", "gpt-4o-mini"));
    model.put("provider", "foundry");
    model.put("apiType", "chat");
    model.put("connection", connection);
    model.put("options", options);

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "live-foundry-project");
    data.put("kind", "prompt");
    data.put("model", model);
    data.put("instructions", "system:\nYou are a helpful assistant. Be very brief.\nuser:\n" + question);
    return Prompty.load(data, new com.microsoft.prompty.model.LoadContext());
  }

  @Test
  void azureDeploymentChatCompletionReturnsText() {
    LiveEnv.require("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT");

    Object result =
        Pipeline.invoke(
            azureAgent("Say hello in exactly 3 words.", Map.of("temperature", 0, "maxOutputTokens", 100)),
            Map.of());

    String text = Pipeline.textOf(result);
    assertNotNull(text);
    assertFalse(text.isBlank(), "chat completion returned no text");
    System.out.println("[foundry/azure] chat -> " + text);
  }

  @Test
  void foundryProjectChatCompletionReturnsText() {
    LiveEnv.require("FOUNDRY_PROJECT_ENDPOINT", "AZURE_INFERENCE_CREDENTIAL");

    Object result =
        Pipeline.invoke(
            foundryAgent("Say hello in exactly 3 words.", Map.of("temperature", 0, "maxOutputTokens", 100)),
            Map.of());

    String text = Pipeline.textOf(result);
    assertNotNull(text);
    assertFalse(text.isBlank(), "chat completion returned no text");
    System.out.println("[foundry/project] chat -> " + text);
  }

  @Test
  void aMissingFoundryCredentialFailsBeforeAnyRequestIsSent() {
    LiveEnv.require("FOUNDRY_PROJECT_ENDPOINT");

    // The credential is restored afterwards because `.env` supplies it as an override, and clearing
    // one without putting it back would make a later test in this class skip for want of a
    // credential the machine actually has.
    String saved = com.microsoft.prompty.Environment.lookup("AZURE_INFERENCE_CREDENTIAL").orElse(null);
    RuntimeException failure = null;
    String credential;
    try {
      com.microsoft.prompty.Environment.clear("AZURE_INFERENCE_CREDENTIAL");
      credential = LiveEnv.get("AZURE_INFERENCE_CREDENTIAL", "");
      try {
        Pipeline.invoke(foundryAgent("Hello", Map.of("maxOutputTokens", 5)), Map.of());
      } catch (RuntimeException e) {
        failure = e;
      }
    } finally {
      if (saved != null) {
        com.microsoft.prompty.Environment.set("AZURE_INFERENCE_CREDENTIAL", saved);
      }
    }

    if (!credential.isBlank()) {
      // The credential lives in the real process environment, which `clear` cannot remove, so the
      // request was legitimately authenticated and there is no absence to assert on. This test only
      // does real work when the credential arrives as an override -- a green result here is not
      // evidence that the missing-credential path behaves correctly.
      return;
    }
    assertNotNull(failure, "a missing credential should fail rather than send an anonymous request");
    String message = String.valueOf(failure.getMessage());
    assertTrue(
        message.contains("AZURE_INFERENCE_CREDENTIAL"),
        "the error should name the variable that was missing but said: " + message);
    System.out.println("[foundry/project] missing credential -> " + message);
  }
}


