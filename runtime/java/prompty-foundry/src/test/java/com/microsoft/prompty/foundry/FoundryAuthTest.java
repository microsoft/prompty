package com.microsoft.prompty.foundry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.ApiKeyConnection;
import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.FoundryConnection;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Credential precedence and blank handling for Foundry connections. */
class FoundryAuthTest {

  private static ApiKeyConnection key(String apiKey) {
    ApiKeyConnection connection = new ApiKeyConnection();
    connection.kind = "key";
    connection.endpoint = "https://example.openai.azure.com";
    connection.apiKey = apiKey;
    return connection;
  }

  @Test
  void anApiKeyIsReadFromTheConnection() {
    assertEquals(Optional.of("secret"), FoundryAuth.apiKey(key("secret")));
  }

  @Test
  void surroundingWhitespaceIsTrimmed() {
    // A key pasted out of a portal commonly carries a trailing newline.
    assertEquals(Optional.of("secret"), FoundryAuth.apiKey(key("  secret\n")));
  }

  @Test
  void aBlankCredentialCountsAsAbsent() {
    // Otherwise the request would authenticate with nothing instead of falling through.
    assertTrue(FoundryAuth.apiKey(key("   ")).isEmpty());
    assertTrue(FoundryAuth.apiKey(key("")).isEmpty());
    assertTrue(FoundryAuth.bearerToken(key(" ")).isEmpty());
  }

  @Test
  void aBearerTokenAcceptsTheApiKeyFieldForCompatibility() {
    // Hosts commonly carry an OAuth token in apiKey.
    assertEquals(Optional.of("token"), FoundryAuth.bearerToken(key("token")));
  }

  @Test
  void aFoundryConnectionCarriesNoInlineCredential() {
    // The generated Foundry connection declares only an endpoint, name, and type, so the token has
    // to come from the environment.
    FoundryConnection connection = new FoundryConnection();
    connection.kind = "foundry";
    connection.endpoint = "https://example.services.ai.azure.com";
    assertTrue(FoundryAuth.bearerToken(connection).isEmpty());
    assertTrue(FoundryAuth.apiKey(connection).isEmpty());
  }

  @Test
  void anAbsentConnectionIsNotAnError() {
    Connection none = null;
    assertTrue(FoundryAuth.apiKey(none).isEmpty());
    assertTrue(FoundryAuth.bearerToken(none).isEmpty());
  }
}
