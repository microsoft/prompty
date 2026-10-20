package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.Agent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Endpoint trust (spec §2.5.1). */
class EndpointTrustTest {

  private static final String ENV = EndpointTrust.TRUSTED_ENDPOINTS_ENV;

  @TempDir Path tmp;

  @BeforeEach
  void maskEnv() {
    Environment.mask(ENV);
  }

  @AfterEach
  void clearEnv() {
    Environment.clear(ENV);
  }

  private Path write(String connection) throws IOException {
    Path p = tmp.resolve("t.prompty");
    Files.writeString(
        p,
        "---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n" + connection + "\n---\nHello\n",
        StandardCharsets.UTF_8);
    return p;
  }

  private static LoadException assertUntrusted(Path p, LoadOptions options) {
    LoadException e = assertThrows(LoadException.class, () -> Loader.load(p, options));
    assertEquals(LoadException.Kind.UNTRUSTED_ENDPOINT, e.kind());
    return e;
  }

  private static LoadException assertUntrusted(Path p) {
    return assertUntrusted(p, LoadOptions.defaults());
  }

  private static java.util.Map<String, Object> save(Agent agent) {
    return agent.model.connection.save(new com.microsoft.prompty.model.SaveContext());
  }

  @Nested
  class IsTrustedEndpoint {

    @ParameterizedTest
    @ValueSource(
        strings = {
          "https://api.openai.com/v1",
          "https://API.OpenAI.com:443",
          "https://myres.openai.azure.com/",
          "https://a.b.services.ai.azure.com/api/projects/p",
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        })
    void builtinTrusted(String url) {
      assertTrue(EndpointTrust.isTrustedEndpoint(url));
    }

    @ParameterizedTest
    @ValueSource(
        strings = {
          "http://api.openai.com", // scheme mismatch
          "https://api.openai.com:8443", // port mismatch
          "https://openai.azure.com", // wildcard never matches apex
          "https://api.openai.com.evil.com",
          "https://evilopenai.azure.com",
          "https://api.openai.com@evil.com", // userinfo ignored; host is evil.com
          "http://localhost:11434",
          "not a url",
          "ftp://api.openai.com",
          "",
        })
    void untrusted(String url) {
      assertFalse(EndpointTrust.isTrustedEndpoint(url));
    }

    @Test
    void hostOptionAndWildcard() {
      assertTrue(
          EndpointTrust.isTrustedEndpoint("http://localhost:11434/v1", List.of("http://LOCALHOST:11434")));
      assertTrue(EndpointTrust.isTrustedEndpoint("https://x.contoso.com", List.of("https://*.contoso.com")));
      assertFalse(EndpointTrust.isTrustedEndpoint("https://contoso.com", List.of("https://*.contoso.com")));
    }

    @Test
    void hostWithUnderscoreParses() {
      assertTrue(
          EndpointTrust.isTrustedEndpoint("https://my_host.example.com/x", List.of("https://my_host.example.com")));
    }

    @Test
    void envListAndStar() {
      Environment.set(ENV, " https://a.example.com , http://localhost:8080");
      assertTrue(EndpointTrust.isTrustedEndpoint("http://localhost:8080/x"));
      assertFalse(EndpointTrust.isTrustedEndpoint("http://localhost:8081"));
      Environment.set(ENV, "*");
      assertTrue(EndpointTrust.isTrustedEndpoint("http://anything.example"));
    }
  }

  @Nested
  class LoaderEnforcement {

    @Test
    void ambientLiteralEndpointRejected() throws IOException {
      LoadException e = assertUntrusted(write("    kind: foundry\n    endpoint: http://127.0.0.1:9999"));
      assertTrue(e.getMessage().contains("127.0.0.1"));
    }

    @Test
    void envKeyLiteralEndpointRejected() throws IOException {
      Environment.set("SOME_KEY", "secret");
      try {
        LoadException e =
            assertUntrusted(
                write("    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}"));
        assertTrue(e.getMessage().contains("not trusted"));
      } finally {
        Environment.clear("SOME_KEY");
      }
    }

    @Test
    void oauthTokenUrlChecked() throws IOException {
      Environment.set("SECRET", "s");
      try {
        LoadException e =
            assertUntrusted(
                write(
                    "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n"
                        + "    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token"));
        assertTrue(e.getMessage().contains("tokenUrl"));
      } finally {
        Environment.clear("SECRET");
      }
    }

    @Test
    void mismatchedCredentialFieldRejected() throws IOException {
      assertUntrusted(write("    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk"));
      assertUntrusted(write("    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk"));
    }

    @Test
    void literalKeyAllowed() throws IOException {
      Agent agent = Loader.load(write("    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine"));
      assertEquals(
          "http://127.0.0.1:9999",
          ((com.microsoft.prompty.model.ApiKeyConnection) agent.model.connection).endpoint);
    }

    @Test
    void envEndpointAllowed() throws IOException {
      Environment.set("EP", "http://127.0.0.1:9999");
      try {
        Agent agent = Loader.load(write("    kind: foundry\n    endpoint: ${env:EP}"));
        assertEquals("http://127.0.0.1:9999", save(agent).get("endpoint"));
      } finally {
        Environment.clear("EP");
      }
    }

    @Test
    void envDefaultUsedRejected() throws IOException {
      Environment.mask("UNSET_EP");
      try {
        assertUntrusted(write("    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}"));
      } finally {
        Environment.clear("UNSET_EP");
      }
    }

    @Test
    void trustedOptionAllows() throws IOException {
      Path p = write("    kind: foundry\n    endpoint: http://127.0.0.1:9999/api");
      Agent agent = Loader.load(p, LoadOptions.withTrustedEndpoints("http://127.0.0.1:9999"));
      assertEquals("http://127.0.0.1:9999/api", save(agent).get("endpoint"));
    }

    @Test
    void loadFromStringHonorsOption() {
      String raw =
          "---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n    kind: foundry\n"
              + "    endpoint: http://127.0.0.1:9999\n---\nHi\n";
      Path base = tmp.resolve("virtual.prompty");
      LoadException e = assertThrows(LoadException.class, () -> Loader.loadFromString(raw, base));
      assertEquals(LoadException.Kind.UNTRUSTED_ENDPOINT, e.kind());
      Agent agent =
          Loader.loadFromString(raw, base, LoadOptions.withTrustedEndpoints("http://127.0.0.1:9999"));
      assertEquals("http://127.0.0.1:9999", save(agent).get("endpoint"));
    }

    @Test
    void fileModelReferenceChecked() throws IOException {
      Files.writeString(
          tmp.resolve("model.json"),
          "{\"id\": \"gpt-4\", \"connection\": {\"kind\": \"foundry\", \"endpoint\": \"https://evil.example.com\"}}",
          StandardCharsets.UTF_8);
      Path p = tmp.resolve("t.prompty");
      Files.writeString(p, "---\nname: t\nmodel: ${file:model.json}\n---\nHi\n", StandardCharsets.UTF_8);
      LoadException e = assertUntrusted(p);
      assertTrue(e.getMessage().contains("not trusted"));
    }

    @Test
    void traversalFileConnectionRaisesFileReference() throws IOException {
      Path sub = Files.createDirectories(tmp.resolve("agent"));
      Files.writeString(
          tmp.resolve("conn.json"),
          "{\"kind\": \"foundry\", \"endpoint\": \"https://evil.example.com\"}",
          StandardCharsets.UTF_8);
      Path p = sub.resolve("t.prompty");
      Files.writeString(
          p,
          "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:../conn.json}\n---\nHi\n",
          StandardCharsets.UTF_8);
      LoadException e = assertThrows(LoadException.class, () -> Loader.load(p));
      assertEquals(LoadException.Kind.FILE_REFERENCE, e.kind());
    }

    @Test
    void frontmatterCannotSelfTrust() throws IOException {
      Path p = tmp.resolve("t.prompty");
      Files.writeString(
          p,
          "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n"
              + "model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n",
          StandardCharsets.UTF_8);
      assertUntrusted(p);
    }

    @Test
    void referenceKindSkipped() throws IOException {
      Agent agent = Loader.load(write("    kind: reference\n    name: my-connection"));
      assertEquals("reference", save(agent).get("kind"));
    }
  }
}
