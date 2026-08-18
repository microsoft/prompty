package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Environment;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Agent;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Routing and authentication for the Foundry provider.
 *
 * <p>The wire format is covered by the shared vectors through the OpenAI module, so what is left to
 * check here is everything Azure does differently: which URL a request goes to, which header
 * authenticates it, and which fallbacks apply when the prompt leaves something out.
 */
class FoundryExecutorTest {

  private final FoundryExecutor executor = new FoundryExecutor();

  @AfterEach
  void clearEnvironment() {
    Environment.clearAll();
  }

  // ------------------------------------------------------------------ setup

  private static Agent agent(Map<String, Object> model) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "foundry-test");
    data.put("kind", "prompt");
    data.put("instructions", "test");
    data.put("model", model);
    return Agent.load(data, new LoadContext());
  }

  private static Map<String, Object> keyModel() {
    return new LinkedHashMap<>(
        Map.of(
            "id",
            "gpt-4o-mini",
            "provider",
            "foundry",
            "connection",
            Map.of(
                "kind", "key",
                "endpoint", "https://myresource.openai.azure.com",
                "apiKey", "secret")));
  }

  private static Map<String, Object> foundryModel() {
    return new LinkedHashMap<>(
        Map.of(
            "id",
            "gpt-4o-mini",
            "provider",
            "foundry",
            "connection",
            Map.of(
                "kind", "foundry",
                "endpoint", "https://myresource.services.ai.azure.com/api/projects/proj")));
  }

  // -------------------------------------------------------------------- url

  @Test
  void aKeyConnectionAddressesANamedDeployment() {
    assertEquals(
        "https://myresource.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions"
            + "?api-version="
            + FoundryExecutor.DEFAULT_API_VERSION,
        executor.buildUrl(agent(keyModel()), "/v1/chat/completions"));
  }

  @Test
  void embeddingAndImageMapToTheirAzureOperations() {
    assertTrue(
        executor.buildUrl(agent(keyModel()), "/v1/embeddings").contains("/embeddings?api-version="));
    assertTrue(
        executor
            .buildUrl(agent(keyModel()), "/v1/images/generations")
            .contains("/images/generations?api-version="));
  }

  @Test
  void aFoundryConnectionAddressesTheOpenAiSurfaceDirectly() {
    // No deployment segment and no api-version: the OpenAI/v1 surface routes by the model in the
    // body.
    assertEquals(
        "https://myresource.openai.azure.com/openai/v1/chat/completions",
        executor.buildUrl(agent(foundryModel()), "/v1/chat/completions"));
  }

  @Test
  void aTrailingSlashOnTheEndpointDoesNotDoubleUp() {
    Map<String, Object> model = keyModel();
    model.put(
        "connection",
        Map.of(
            "kind", "key",
            "endpoint", "https://myresource.openai.azure.com///",
            "apiKey", "secret"));
    assertTrue(
        executor.buildUrl(agent(model), "/v1/chat/completions").startsWith("https://myresource.openai.azure.com/openai/deployments/"));
  }

  @Test
  void azureHasNoResponsesSurface() {
    InvokerException error =
        assertThrows(
            InvokerException.class, () -> executor.buildUrl(agent(keyModel()), "/v1/responses"));
    assertTrue(error.getMessage().contains("responses"), error.getMessage());
  }

  @Test
  void theApiVersionCanBeOverriddenPerPrompt() {
    Map<String, Object> model = keyModel();
    model.put("options", Map.of("additionalProperties", Map.of("apiVersion", "2024-02-01")));
    assertTrue(
        executor.buildUrl(agent(model), "/v1/chat/completions").endsWith("?api-version=2024-02-01"));
  }

  // ------------------------------------------------------------- fallbacks

  @Test
  void theEndpointFallsBackToTheEnvironment() {
    Environment.set("AZURE_OPENAI_ENDPOINT", "https://fromenv.openai.azure.com");
    Map<String, Object> model = new LinkedHashMap<>(Map.of("id", "gpt-4o-mini"));
    assertTrue(
        executor.buildUrl(agent(model), "/v1/chat/completions").startsWith("https://fromenv.openai.azure.com/"));
  }

  @Test
  void theDeploymentFallsBackToTheEnvironment() {
    Environment.set("AZURE_OPENAI_DEPLOYMENT", "env-deployment");
    Map<String, Object> model = new LinkedHashMap<>(keyModel());
    model.remove("id");
    assertTrue(
        executor.buildUrl(agent(model), "/v1/chat/completions").contains("/deployments/env-deployment/"));
  }

  @Test
  void aMissingEndpointIsReportedRatherThanGuessed() {
    Environment.mask("AZURE_OPENAI_ENDPOINT");
    Map<String, Object> model = new LinkedHashMap<>(Map.of("id", "gpt-4o-mini"));
    InvokerException error =
        assertThrows(
            InvokerException.class, () -> executor.buildUrl(agent(model), "/v1/chat/completions"));
    assertTrue(error.getMessage().contains("AZURE_OPENAI_ENDPOINT"), error.getMessage());
  }

  @Test
  void aMissingDeploymentIsReportedRatherThanGuessed() {
    Environment.mask("AZURE_OPENAI_DEPLOYMENT");
    Map<String, Object> model = new LinkedHashMap<>(keyModel());
    model.remove("id");
    InvokerException error =
        assertThrows(
            InvokerException.class, () -> executor.buildUrl(agent(model), "/v1/chat/completions"));
    assertTrue(error.getMessage().contains("AZURE_OPENAI_DEPLOYMENT"), error.getMessage());
  }

  // ------------------------------------------------------------------- auth

  @Test
  void aKeyConnectionUsesTheAzureApiKeyHeader() {
    // Azure authenticates with api-key, not an Authorization bearer.
    assertEquals(Map.of("api-key", "secret"), executor.authHeaders(agent(keyModel())));
  }

  @Test
  void theApiKeyFallsBackToTheEnvironment() {
    Environment.set("AZURE_OPENAI_API_KEY", "env-key");
    Map<String, Object> model = keyModel();
    model.put(
        "connection", Map.of("kind", "key", "endpoint", "https://myresource.openai.azure.com"));
    assertEquals(Map.of("api-key", "env-key"), executor.authHeaders(agent(model)));
  }

  @Test
  void aMissingApiKeyIsReportedRatherThanSentEmpty() {
    Environment.mask("AZURE_OPENAI_API_KEY");
    Map<String, Object> model = keyModel();
    model.put(
        "connection", Map.of("kind", "key", "endpoint", "https://myresource.openai.azure.com"));
    InvokerException error =
        assertThrows(InvokerException.class, () -> executor.authHeaders(agent(model)));
    assertTrue(error.getMessage().contains("AZURE_OPENAI_API_KEY"), error.getMessage());
  }

  @Test
  void aFoundryConnectionUsesABearerToken() {
    Environment.set("AZURE_INFERENCE_CREDENTIAL", "token-abc");
    assertEquals(
        Map.of("Authorization", "Bearer token-abc"), executor.authHeaders(agent(foundryModel())));
  }

  @Test
  void aMissingFoundryTokenIsReportedRatherThanFallingBackToAKey() {
    // An api-key would be silently rejected by the Foundry surface, so the absence is reported.
    // The token is masked rather than merely cleared: a machine that exports
    // AZURE_INFERENCE_CREDENTIAL for live runs would otherwise satisfy the lookup and there would
    // be no absence left to assert on.
    Environment.mask("AZURE_INFERENCE_CREDENTIAL");
    Environment.set("AZURE_OPENAI_API_KEY", "not-a-token");
    InvokerException error =
        assertThrows(InvokerException.class, () -> executor.authHeaders(agent(foundryModel())));
    assertTrue(error.getMessage().contains("AZURE_INFERENCE_CREDENTIAL"), error.getMessage());
  }

  // ------------------------------------------------------- endpoint rewrite

  @Test
  void aProjectEndpointBecomesTheInferenceSurface() {
    assertEquals(
        "https://myresource.openai.azure.com/openai/v1",
        FoundryExecutor.stripProjectPath(
            "https://myresource.services.ai.azure.com/api/projects/my-project"));
  }

  @Test
  void aProjectEndpointWithoutAProjectPathStillResolves() {
    assertEquals(
        "https://myresource.openai.azure.com/openai/v1",
        FoundryExecutor.stripProjectPath("https://myresource.services.ai.azure.com"));
  }

  @Test
  void aHostThatIsNotAServicesHostKeepsItsName() {
    assertEquals(
        "https://custom.example.com/openai/v1",
        FoundryExecutor.stripProjectPath("https://custom.example.com/api/projects/p"));
  }

  @Test
  void aPortIsCarriedThrough() {
    assertEquals(
        "https://localhost:8443/openai/v1", FoundryExecutor.stripProjectPath("https://localhost:8443"));
  }

  @Test
  void somethingThatIsNotAUrlIsLeftAlone() {
    // A colon that is not a port must not be mistaken for one either.
    assertEquals("not-a-url", FoundryExecutor.stripProjectPath("not-a-url"));
    assertEquals(
        "https://host:notaport/openai/v1", FoundryExecutor.stripProjectPath("https://host:notaport"));
  }

  @Test
  void aColonThatIsNotAPortDoesNotHideTheServicesHost() {
    // Splitting userinfo off as if it were a port would leave the host looking like "https", and
    // the endpoint would never be rewritten to the inference surface.
    assertEquals(
        "https://user:pass@myresource.openai.azure.com/openai/v1",
        FoundryExecutor.stripProjectPath("https://user:pass@myresource.services.ai.azure.com"));
  }

  @Test
  void aRealPortOnAServicesHostSurvivesTheRewrite() {
    assertEquals(
        "https://myresource.openai.azure.com:8443/openai/v1",
        FoundryExecutor.stripProjectPath("https://myresource.services.ai.azure.com:8443/api/projects/p"));
  }

  // ------------------------------------------------------------- processor

  @Test
  void theProcessorDoesNotOfferAContinuationAzureCannotHonour() {
    FoundryProcessor processor = new FoundryProcessor();
    assertEquals("foundry", processor.providerName());
    assertFalse(processor.supportsResponsesContinuation());
  }
}
