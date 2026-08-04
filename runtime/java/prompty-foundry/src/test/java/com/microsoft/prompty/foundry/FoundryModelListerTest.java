package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Environment;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.model.ModelInfo;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Model listing for Foundry and Azure OpenAI connections.
 *
 * <p>The mapping from wire shape to {@link ModelInfo} is covered by the shared discovery vectors,
 * so this suite is about the parts the vectors cannot reach: which service a connection kind is
 * routed to, how the URL and credential are assembled, and what happens on the failure paths.
 */
class FoundryModelListerTest {

  private HttpServer server;
  private String baseUrl;
  private final List<String> requests = new ArrayList<>();

  @BeforeEach
  void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
    baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    requests.clear();
  }

  @AfterEach
  void stopServer() {
    server.stop(0);
    Environment.clearAll();
  }

  /** Record the request line and auth headers, then answer with a fixed body. */
  private void respond(String path, String body) {
    server.createContext(
        path,
        exchange -> {
          requests.add(
              exchange.getRequestURI().toString()
                  + "|Authorization="
                  + exchange.getRequestHeaders().getFirst("Authorization")
                  + "|api-key="
                  + exchange.getRequestHeaders().getFirst("api-key"));
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
          }
        });
  }

  @Nested
  @DisplayName("connection kind routing")
  class Routing {

    @Test
    void aFoundryConnectionListsDeployments() {
      respond(
          "/deployments",
          "{\"value\":[{\"name\":\"gpt-4o-prod\",\"modelName\":\"gpt-4o\","
              + "\"modelPublisher\":\"OpenAI\"}]}");

      List<ModelInfo> models =
          new FoundryModelLister()
              .listModels(
                  Map.of("kind", "foundry", "endpoint", baseUrl, "apiKey", "token-abc"));

      // The deployment name is the invokable identifier, so it is what lands in id.
      assertEquals(List.of("gpt-4o-prod"), models.stream().map(m -> m.id).toList());
      assertEquals("gpt-4o", models.get(0).displayName);
      assertTrue(
          requests.get(0).startsWith("/deployments?api-version=v1|Authorization=Bearer token-abc"),
          "request was: " + requests.get(0));
    }

    @Test
    void aKeyConnectionListsTheModelCatalog() {
      respond("/openai/models", "{\"data\":[{\"id\":\"gpt-4o\",\"owned_by\":\"openai\"}]}");

      List<ModelInfo> models =
          new FoundryModelLister()
              .listModels(Map.of("kind", "key", "endpoint", baseUrl, "apiKey", "secret"));

      assertEquals(List.of("gpt-4o"), models.stream().map(m -> m.id).toList());
      // The catalog authenticates with the Azure api-key header, not a bearer token.
      assertTrue(requests.get(0).contains("|api-key=secret"), "request was: " + requests.get(0));
      assertTrue(
          requests.get(0).contains("Authorization=null"), "request was: " + requests.get(0));
    }

    @Test
    void anUnsupportedKindIsRejectedBeforeAnyRequest() {
      // Falling through to one of the two services would produce a confusing transport error for
      // what is really a configuration mistake.
      InvokerException error =
          assertThrows(
              InvokerException.class,
              () -> new FoundryModelLister().listModels(Map.of("kind", "reference")));

      assertTrue(error.getMessage().contains("reference"), error.getMessage());
      assertTrue(error.getMessage().contains("foundry"), error.getMessage());
      assertEquals(0, requests.size());
    }

    @Test
    void aNonMapConnectionIsRejectedRatherThanCrashing() {
      assertThrows(
          InvokerException.class, () -> new FoundryModelLister().listModels("not-a-connection"));
    }
  }

  @Nested
  @DisplayName("url assembly")
  class Urls {

    @Test
    void aTrailingSlashDoesNotDoubleUp() {
      assertEquals(
          "https://p.example/deployments?api-version=v1",
          FoundryModelLister.deploymentsUrl(Map.of("endpoint", "https://p.example///")));
    }

    @Test
    void anAbsentDeploymentEndpointIsRejected() {
      // There is no environment fallback for a project endpoint, so guessing would be wrong.
      assertThrows(
          InvokerException.class, () -> FoundryModelLister.deploymentsUrl(Map.of()));
    }

    @Test
    void theCatalogEndpointFallsBackToTheEnvironment() {
      Environment.set("AZURE_OPENAI_ENDPOINT", "https://acct.openai.azure.com/");

      assertEquals(
          "https://acct.openai.azure.com/openai/models?api-version="
              + FoundryModelLister.DEFAULT_API_VERSION,
          FoundryModelLister.catalogUrl(Map.of()));
    }

    @Test
    void aConnectionApiVersionOverridesTheDefault() {
      assertEquals(
          "https://a.example/openai/models?api-version=2024-06-01",
          FoundryModelLister.catalogUrl(
              Map.of("endpoint", "https://a.example", "apiVersion", "2024-06-01")));
    }

    @Test
    void anAbsentCatalogEndpointIsRejected() {
      // The catalog URL does fall back to AZURE_OPENAI_ENDPOINT, so the absence has to be
      // asserted against a masked name rather than a merely unset one.
      Environment.mask("AZURE_OPENAI_ENDPOINT");
      assertThrows(InvokerException.class, () -> FoundryModelLister.catalogUrl(Map.of()));
    }
  }

  @Nested
  @DisplayName("credential resolution")
  class Credentials {

    @Test
    void anUndeclaredSnakeCaseAliasIsStillAccepted() {
      // Listing takes its connection as raw JSON, so unlike the typed executor path it can see the
      // aliases a host may have written.
      assertEquals("t", FoundryModelLister.deploymentToken(Map.of("bearer_token", "t")));
      assertEquals("k", FoundryModelLister.catalogKey(Map.of("api_key", "k")));
    }

    @Test
    void aBlankCredentialIsTreatedAsAbsent() {
      // Sending an empty bearer would produce a 401 that reads like a permissions problem.
      assertThrows(
          InvokerException.class, () -> FoundryModelLister.deploymentToken(Map.of("apiKey", "   ")));
    }

    @Test
    void theCatalogKeyFallsBackToTheEnvironment() {
      Environment.set("AZURE_OPENAI_API_KEY", "env-key");

      assertEquals("env-key", FoundryModelLister.catalogKey(Map.of()));
    }

    @Test
    void aBlankEnvironmentKeyDoesNotSatisfyTheRequirement() {
      Environment.set("AZURE_OPENAI_API_KEY", "  ");

      assertThrows(InvokerException.class, () -> FoundryModelLister.catalogKey(Map.of()));
    }

    @Test
    void aMissingDeploymentTokenNamesTheWayToGetOne() {
      com.microsoft.prompty.Environment.mask("AZURE_INFERENCE_CREDENTIAL");
      InvokerException error =
          assertThrows(
              InvokerException.class, () -> FoundryModelLister.deploymentToken(Map.of()));

      assertTrue(error.getMessage().contains("device code"), error.getMessage());
    }
  }

  @Nested
  @DisplayName("response handling")
  class Responses {

    @Test
    void aProjectWithNoDeploymentsIsEmptyRatherThanAFailure() {
      respond("/deployments", "{\"value\":[]}");

      assertEquals(
          List.of(),
          new FoundryModelLister()
              .listModels(Map.of("kind", "foundry", "endpoint", baseUrl, "apiKey", "t")));
    }

    @Test
    void aResponseMissingTheCollectionIsAlsoEmpty() {
      // Some Azure surfaces omit the key entirely instead of sending an empty array.
      respond("/openai/models", "{}");

      assertEquals(
          List.of(),
          new FoundryModelLister()
              .listModels(Map.of("kind", "key", "endpoint", baseUrl, "apiKey", "k")));
    }
  }
}
