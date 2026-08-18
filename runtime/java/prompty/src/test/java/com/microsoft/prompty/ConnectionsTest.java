package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.ApiKeyConnection;
import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.ReferenceConnection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Named connection resolution — the indirection that keeps secrets out of {@code .prompty} files. */
class ConnectionsTest {

  @AfterEach
  void reset() {
    Connections.clear();
  }

  private static ApiKeyConnection apiKey(String key) {
    ApiKeyConnection connection = new ApiKeyConnection();
    connection.apiKey = key;
    connection.endpoint = "https://example.invalid";
    return connection;
  }

  private static ReferenceConnection reference(String name) {
    ReferenceConnection connection = new ReferenceConnection();
    connection.name = name;
    return connection;
  }

  @Test
  void concreteConnectionsPassThroughUntouched() {
    Connection connection = apiKey("sk-test");
    assertSame(connection, Connections.resolve(connection));
  }

  @Test
  void referencesResolveThroughTheRegistry() {
    ApiKeyConnection target = apiKey("sk-test");
    Connections.register("prod", target);

    assertSame(target, Connections.resolve(reference("prod")));
  }

  @Test
  void referenceChainsResolveToTheirEndpoint() {
    ApiKeyConnection target = apiKey("sk-test");
    Connections.register("base", target);
    Connections.register("alias", reference("base"));

    assertSame(target, Connections.resolve(reference("alias")));
  }

  @Test
  void unknownReferencesFailLoudly() {
    // Silently falling back to an anonymous connection would surface much later as a confusing
    // authentication error against the wrong endpoint.
    InvokerException error =
        assertThrows(InvokerException.class, () -> Connections.resolve(reference("missing")));
    assertTrue(error.getMessage().contains("missing"));
  }

  @Test
  void emptyReferenceNamesFailLoudly() {
    assertThrows(InvokerException.class, () -> Connections.resolve(reference("")));
  }

  @Test
  void referenceCyclesAreDetectedRatherThanHanging() {
    Connections.register("a", reference("b"));
    Connections.register("b", reference("a"));

    InvokerException error =
        assertThrows(InvokerException.class, () -> Connections.resolve(reference("a")));
    assertTrue(error.getMessage().toLowerCase().contains("cycle"));
  }

  @Test
  void registrationsCanBeReplacedAndRemoved() {
    Connections.register("prod", apiKey("first"));
    Connections.register("prod", apiKey("second"));
    assertEquals("second", ((ApiKeyConnection) Connections.resolve(reference("prod"))).apiKey);

    assertTrue(Connections.unregister("prod"));
    assertNotNull(assertThrows(InvokerException.class, () -> Connections.resolve(reference("prod"))));
  }
}
