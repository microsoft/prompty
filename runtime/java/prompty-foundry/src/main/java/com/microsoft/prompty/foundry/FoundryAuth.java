package com.microsoft.prompty.foundry;

import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.SaveContext;
import java.util.Map;
import java.util.Optional;

/**
 * Credential resolution for Foundry provider operations.
 *
 * <p>Credentials are read off the connection's saved form rather than a specific typed field,
 * because the same credential travels under several names depending on which connection shape a
 * host wrote. Blank values are treated as absent, so a connection that carries an empty key still
 * falls through to the environment rather than authenticating with nothing.
 *
 * <p>Java's connections are typed, so an alias the model does not declare — {@code api_key},
 * {@code bearer_token} — is dropped at load and cannot be seen here. Rust reads the connection as
 * raw JSON and so still accepts them. The aliases are kept in the lookup order regardless, so that
 * any of them the generated model does carry resolves in the same precedence as Rust.
 */
final class FoundryAuth {

  private static final String[] API_KEY_FIELDS = {"apiKey", "api_key"};
  private static final String[] BEARER_TOKEN_FIELDS = {
    "bearerToken", "bearer_token", "apiKey", "api_key"
  };

  private FoundryAuth() {}

  /** An API key for Azure OpenAI key-authenticated operations. */
  static Optional<String> apiKey(Connection connection) {
    return apiKey(saved(connection));
  }

  /** As {@link #apiKey(Connection)}, but over a connection already in raw form. */
  static Optional<String> apiKey(Map<?, ?> connection) {
    return firstNonBlank(connection, API_KEY_FIELDS);
  }

  /**
   * A caller-supplied bearer token for Foundry operations.
   *
   * <p>Explicit token fields win. The API-key names stay in the list because hosts commonly carry
   * an OAuth token in {@code apiKey}.
   */
  static Optional<String> bearerToken(Connection connection) {
    return bearerToken(saved(connection));
  }

  /**
   * As {@link #bearerToken(Connection)}, but over a connection already in raw form.
   *
   * <p>Callers holding raw JSON — model listing takes its connection as {@code Object} — reach the
   * undeclared aliases this way, which is what Rust does everywhere.
   */
  static Optional<String> bearerToken(Map<?, ?> connection) {
    return firstNonBlank(connection, BEARER_TOKEN_FIELDS);
  }

  private static Map<String, Object> saved(Connection connection) {
    return connection == null ? Map.of() : connection.save(new SaveContext());
  }

  private static Optional<String> firstNonBlank(Map<?, ?> saved, String[] fields) {
    if (saved == null) {
      return Optional.empty();
    }
    for (String field : fields) {
      if (saved.get(field) instanceof String value) {
        String trimmed = value.trim();
        if (!trimmed.isEmpty()) {
          return Optional.of(trimmed);
        }
      }
    }
    return Optional.empty();
  }
}
