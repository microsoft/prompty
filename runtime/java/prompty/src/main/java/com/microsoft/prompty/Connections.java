package com.microsoft.prompty;

import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.ReferenceConnection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Named connections a prompt can refer to instead of embedding.
 *
 * <p>A {@code kind: reference} connection names a connection the host supplies at runtime. That
 * indirection is what lets a {@code .prompty} file be committed, shared, and reviewed without
 * carrying an endpoint or a credential — the file says which connection it needs, the host decides
 * what that resolves to.
 */
public final class Connections {

  private static final Map<String, Connection> REGISTERED = new ConcurrentHashMap<>();

  private Connections() {}

  /** Register a connection under a name prompts can reference. */
  public static void register(String name, Connection connection) {
    if (name == null || name.isEmpty()) {
      throw new IllegalArgumentException("Connection name must not be empty");
    }
    if (connection == null) {
      throw new IllegalArgumentException("Connection must not be null");
    }
    REGISTERED.put(name, connection);
  }

  /** Remove a registered connection, reporting whether one was present. */
  public static boolean unregister(String name) {
    return REGISTERED.remove(name) != null;
  }

  /** Forget every registered connection. Intended for tests. */
  public static void clear() {
    REGISTERED.clear();
  }

  /** Look up a registered connection, or null when the name is unknown. */
  public static Connection get(String name) {
    return name == null ? null : REGISTERED.get(name);
  }

  /**
   * Follow a connection to the one that actually carries endpoint and credentials.
   *
   * <p>Anything that is not a reference is already concrete and is returned unchanged.
   *
   * @throws InvokerException with {@link InvokerException.Kind#EXECUTE} when a reference names a
   *     connection nothing has registered — failing here says which name was missing, whereas
   *     proceeding would surface later as an unexplained authentication error
   */
  public static Connection resolve(Connection connection) {
    Connection current = connection;
    // A reference may legitimately point at another; a cycle among them is a configuration mistake
    // that would otherwise hang, so the chain is walked with the names already seen.
    java.util.Set<String> seen = new java.util.LinkedHashSet<>();
    while (current instanceof ReferenceConnection reference) {
      if (reference.name == null || reference.name.isEmpty()) {
        throw InvokerException.execute("Reference connection is missing its 'name'");
      }
      if (!seen.add(reference.name)) {
        throw InvokerException.execute(
            "Connection reference cycle: " + String.join(" -> ", seen) + " -> " + reference.name);
      }
      Connection resolved = REGISTERED.get(reference.name);
      if (resolved == null) {
        throw InvokerException.execute(
            "No connection registered under '"
                + reference.name
                + "'; register it with Connections.register before running this prompt");
      }
      current = resolved;
    }
    return current;
  }
}
