package com.microsoft.prompty;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The source of values for {@code ${env:...}} references.
 *
 * <p>Resolution consults, in order: values set through {@link #set}, JVM system properties, then the
 * process environment. The first two exist because a JVM cannot modify its own environment — without
 * them, configuration could only ever come from outside the process, which makes tests awkward and
 * makes it impossible for a host application to supply secrets it has already loaded (from a key
 * vault, a {@code .env} file, or its own configuration system).
 *
 * <p>Explicit overrides win so that a caller who has deliberately supplied a value is never
 * second-guessed by the ambient environment.
 */
public final class Environment {

  private static final Map<String, String> OVERRIDES = new ConcurrentHashMap<>();

  private Environment() {}

  /** Supply a value for {@code name}, taking precedence over system properties and the process environment. */
  public static void set(String name, String value) {
    if (value == null) {
      OVERRIDES.remove(name);
    } else {
      OVERRIDES.put(name, value);
    }
  }

  /** Remove a value previously supplied through {@link #set}. */
  public static void clear(String name) {
    OVERRIDES.remove(name);
  }

  /** Remove every value previously supplied through {@link #set}. */
  public static void clearAll() {
    OVERRIDES.clear();
  }

  /** Look up {@code name}, or an empty optional if it is set nowhere. */
  public static Optional<String> lookup(String name) {
    String override = OVERRIDES.get(name);
    if (override != null) {
      return Optional.of(override);
    }
    String property = System.getProperty(name);
    if (property != null) {
      return Optional.of(property);
    }
    return Optional.ofNullable(System.getenv(name));
  }
}
