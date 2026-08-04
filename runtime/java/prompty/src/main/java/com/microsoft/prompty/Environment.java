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
 *
 * <p>{@link #mask} is the other half of that control: a JVM cannot remove a variable from its own
 * environment, so without it a caller could add a value but never state that one is deliberately
 * absent. That asymmetry leaves behaviour at the mercy of whatever the surrounding machine happens
 * to export -- a test for "no credential is configured" would pass on a clean machine and fail on a
 * developer's, and a host that wants to run a prompt without inheriting an ambient key could not
 * say so.
 */
public final class Environment {

  /**
   * Decisions that outrank the surrounding process, keyed by name.
   *
   * <p>A present optional is a value supplied through {@link #set}; an empty one is a mask. Holding
   * both states in one entry is what makes each of {@link #set}, {@link #mask} and {@link #clear} a
   * single map mutation, so a concurrent {@link #lookup} always sees one decision or the other and
   * never a gap in which the ambient value shows through.
   */
  private static final Map<String, Optional<String>> DECISIONS = new ConcurrentHashMap<>();

  private Environment() {}

  /**
   * Supply a value for {@code name}, taking precedence over system properties and the process
   * environment. A null value drops any decision recorded here, exactly as {@link #clear} does.
   */
  public static void set(String name, String value) {
    if (value == null) {
      DECISIONS.remove(name);
    } else {
      DECISIONS.put(name, Optional.of(value));
    }
  }

  /**
   * Report {@code name} as unset, whatever the system properties and process environment say.
   *
   * <p>This is not the same as {@link #clear}: clearing drops a decision made here and lets
   * resolution fall back to the surrounding process, whereas masking stops that fallback. Undo it
   * with {@link #clear} or {@link #set}; whichever of {@code set} and {@code mask} runs last wins.
   */
  public static void mask(String name) {
    DECISIONS.put(name, Optional.empty());
  }

  /** Remove a value previously supplied through {@link #set}, or a mask applied by {@link #mask}. */
  public static void clear(String name) {
    DECISIONS.remove(name);
  }

  /** Remove every value supplied through {@link #set} and every mask applied by {@link #mask}. */
  public static void clearAll() {
    DECISIONS.clear();
  }

  /** Look up {@code name}, or an empty optional if it is set nowhere or has been masked. */
  public static Optional<String> lookup(String name) {
    Optional<String> decision = DECISIONS.get(name);
    if (decision != null) {
      return decision;
    }
    String property = System.getProperty(name);
    if (property != null) {
      return Optional.of(property);
    }
    return Optional.ofNullable(System.getenv(name));
  }
}
