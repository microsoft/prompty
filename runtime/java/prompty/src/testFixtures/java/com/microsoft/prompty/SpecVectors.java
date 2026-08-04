package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.microsoft.prompty.model.TypraJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Access to the shared cross-runtime spec vectors, and the partial matcher they are written for.
 *
 * <p>The vectors under {@code spec/vectors} are the contract every Prompty runtime is measured
 * against, so this harness reads them from the repository rather than copying them into the Java
 * tree — a copy could drift, and drift here would be invisible.
 *
 * <p>Matching is deliberately partial: a vector asserts the fields it cares about and stays silent
 * about the rest. That keeps a vector focused on the behaviour it is describing and lets runtimes
 * carry additional detail without every vector needing to enumerate it.
 */
public final class SpecVectors {

  private SpecVectors() {}

  /** The repository root, located by walking up until {@code spec/vectors} is found. */
  public static Path repoRoot() {
    Path current = Path.of("").toAbsolutePath();
    while (current != null) {
      if (Files.isDirectory(current.resolve("spec").resolve("vectors"))) {
        return current;
      }
      current = current.getParent();
    }
    throw new IllegalStateException("could not locate the repository root from " + Path.of("").toAbsolutePath());
  }

  /** The directory holding shared {@code .prompty} fixtures. */
  public static Path fixtures() {
    return repoRoot().resolve("spec").resolve("fixtures");
  }

  /** Read and parse a vector file such as {@code load/load_vectors.json}. */
  public static Object read(String relativePath) {
    Path path = repoRoot().resolve("spec").resolve("vectors").resolve(relativePath);
    try {
      return TypraJson.parse(Files.readString(path, StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException("cannot read spec vectors: " + path, e);
    }
  }

  /** Read a vector file that holds a bare JSON array of cases. */
  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> readArray(String relativePath) {
    Object parsed = read(relativePath);
    if (!(parsed instanceof List<?> list)) {
      throw new IllegalStateException(relativePath + " is not a JSON array");
    }
    List<Map<String, Object>> cases = new ArrayList<>(list.size());
    for (Object item : list) {
      cases.add((Map<String, Object>) item);
    }
    return cases;
  }

  /**
   * Read the cases from a vector file that wraps them under a named key.
   *
   * <p>Some suites are a bare array; the newer ones carry a description alongside the cases, which
   * is worth keeping because it states the contract the vectors are asserting.
   */
  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> readCases(String relativePath, String key) {
    Object parsed = read(relativePath);
    if (!(parsed instanceof Map<?, ?> root) || !(root.get(key) instanceof List<?> list)) {
      throw new IllegalStateException(relativePath + " has no '" + key + "' array");
    }
    List<Map<String, Object>> cases = new ArrayList<>(list.size());
    for (Object item : list) {
      cases.add((Map<String, Object>) item);
    }
    return cases;
  }

  /** A map-valued member of {@code value}, or an empty map when absent. */
  @SuppressWarnings("unchecked")
  public static Map<String, Object> map(Map<String, Object> value, String key) {
    Object nested = value == null ? null : value.get(key);
    return nested instanceof Map<?, ?> ? (Map<String, Object>) nested : Map.of();
  }

  /** A string-valued member of {@code value}, or null when absent or not a string. */
  public static String string(Map<String, Object> value, String key) {
    Object nested = value == null ? null : value.get(key);
    return nested instanceof String text ? text : null;
  }

  // ---------------------------------------------------------------- matching

  /**
   * Assert that {@code actual} contains everything {@code expected} specifies.
   *
   * <p>Maps are matched key by key and lists element by element; scalars must be equal. An expected
   * null asserts only that the actual value carries nothing, which is how a vector says "this field
   * should not be populated" without having to describe the whole surrounding object. Null, an empty
   * list and an empty map all satisfy it: the generated models materialize optional collections, so
   * a field the wire never supplied still arrives as an empty collection rather than disappearing.
   * An empty string is <em>not</em> absent — it is a value a vector has to state explicitly.
   *
   * <p>This is deliberately a <em>subset</em> match: a key the vector does not mention is not
   * checked. That is what lets a load vector describe one corner of a prompt without restating the
   * whole thing. Where a vector describes a complete artefact — a request body, a processed result —
   * use {@link #assertEquivalent} instead, which also rejects fields the vector never asked for.
   *
   * <p>Numbers compare by value rather than by boxed type, since JSON makes no distinction between
   * an integer parsed as {@code Long} and one parsed as {@code Integer}.
   */
  public static void assertMatches(String label, Object expected, Object actual) {
    assertMatches(label, "", expected, actual);
  }

  /**
   * Assert that {@code actual} is exactly what {@code expected} describes, with no extra fields.
   *
   * <p>Same comparison as {@link #assertMatches} with one addition: objects must have exactly the
   * same set of keys. A vector that fully describes a request body is also asserting that nothing
   * else is sent, and a subset match would let a runtime add a spurious field to every request
   * without a single test noticing.
   *
   * <p>This is the reference implementation's comparison but for two deliberate relaxations. Numbers
   * are compared to single precision rather than bit-exactly, because a 32-bit {@code temperature}
   * cannot hold a value like 0.7 that the vector states in full precision. An expected null is
   * satisfied by an empty collection as well as by a missing value, for the reason given on {@link
   * #assertMatches}. Note that the key-set check is not relaxed: a vector that omits a key entirely
   * still rejects a runtime that emits it, even as an empty collection. Every other difference fails
   * here exactly as it would there.
   */
  public static void assertEquivalent(String label, Object expected, Object actual) {
    assertSameKeys(label, "", expected, actual);
    assertMatches(label, "", expected, actual);
  }

  /**
   * Assert that every object in the two trees has the same key set.
   *
   * <p>Both directions matter. An unexpected key means the runtime sends something the vector never
   * described; a missing one means it dropped a field the vector requires. {@link #assertMatches}
   * catches neither on its own — it walks only the expected side, and it accepts an absent key
   * wherever the vector states an explicit null.
   */
  private static void assertSameKeys(String label, String path, Object expected, Object actual) {
    String where = label + (path.isEmpty() ? "" : " at " + path);

    if (expected instanceof Map<?, ?> expectedMap) {
      Object candidate = actual instanceof List<?> list ? asNamedMap(list) : actual;
      if (!(candidate instanceof Map<?, ?> actualMap)) {
        // The shape mismatch itself is reported by assertMatches, in better terms than here.
        return;
      }
      for (Object key : actualMap.keySet()) {
        assertTrue(
            expectedMap.containsKey(key),
            where + ": unexpected field '" + key + "' the vector does not describe");
      }
      for (Map.Entry<?, ?> entry : expectedMap.entrySet()) {
        String key = String.valueOf(entry.getKey());
        assertTrue(
            actualMap.containsKey(key), where + ": missing field '" + key + "' the vector requires");
        assertSameKeys(label, join(path, key), entry.getValue(), actualMap.get(key));
      }
      return;
    }

    if (expected instanceof List<?> expectedList) {
      Object candidate = actual instanceof Map<?, ?> named ? asNamedList(named) : actual;
      if (!(candidate instanceof List<?> actualList)) {
        return;
      }
      int shared = Math.min(expectedList.size(), actualList.size());
      for (int i = 0; i < shared; i++) {
        assertSameKeys(label, path + "[" + i + "]", expectedList.get(i), actualList.get(i));
      }
    }
  }

  private static void assertMatches(String label, String path, Object expected, Object actual) {
    String where = label + (path.isEmpty() ? "" : " at " + path);

    if (expected == null) {
      // A vector writes `null` for "this field carries nothing". Runtimes are free to spell that as
      // an absent value or as an empty collection: the models materialize optional collections
      // (`tools?: Tool[] = #[]` becomes an empty list, matching C#, TypeScript and Rust), so an
      // empty list or map means the same thing to a caller as no list at all. The reference
      // implementation reconciles the two at this same seam — Rust's `as_tools()` reports `None`
      // for an empty vector, and Python checks length rather than identity. A non-empty value is
      // still a real difference and fails here.
      assertTrue(isAbsent(actual), where + ": expected absent or empty, got " + describe(actual));
      return;
    }

    if (expected instanceof Map<?, ?> expectedMap) {
      Object candidate = actual instanceof List<?> list ? asNamedMap(list) : actual;
      assertTrue(candidate instanceof Map<?, ?>, where + ": expected an object, got " + describe(actual));
      Map<?, ?> actualMap = (Map<?, ?>) candidate;
      for (Map.Entry<?, ?> entry : expectedMap.entrySet()) {
        String key = String.valueOf(entry.getKey());
        assertMatches(label, join(path, key), entry.getValue(), actualMap.get(key));
      }
      return;
    }

    if (expected instanceof List<?> expectedList) {
      Object candidate = actual instanceof Map<?, ?> named ? asNamedList(named) : actual;
      assertTrue(candidate instanceof List<?>, where + ": expected an array, got " + describe(actual));
      List<?> actualList = (List<?>) candidate;
      assertEquals(expectedList.size(), actualList.size(), where + ": array length");
      for (int i = 0; i < expectedList.size(); i++) {
        assertMatches(label, path + "[" + i + "]", expectedList.get(i), actualList.get(i));
      }
      return;
    }

    if (expected instanceof Number expectedNumber && actual instanceof Number actualNumber) {
      // Vectors are written in JSON, which has one number type; runtimes store them at whatever
      // width the schema declares. A 32-bit `temperature` cannot hold 0.7 exactly, so compare at
      // single precision rather than demanding a bit-exact match the schema never promised.
      double want = expectedNumber.doubleValue();
      double got = actualNumber.doubleValue();
      double tolerance = 1e-6 * Math.max(1.0, Math.abs(want));
      assertTrue(
          Math.abs(want - got) <= tolerance, where + ": expected " + want + ", got " + got);
      return;
    }

    assertEquals(expected, actual, where);
  }

  private static String join(String path, String key) {
    return path.isEmpty() ? key : path + "." + key;
  }

  /**
   * Rewrite a named collection — {@code {alice: {...}, bob: {...}}} — as the list it stands for.
   *
   * <p>Several collections in the model are written with the item's name as the key, because that is
   * how a prompt author naturally writes them and it rules out duplicates. Both forms round-trip to
   * the same object graph, and the vectors use whichever reads better case by case, so the two are
   * reconciled here rather than in every vector.
   */
  private static List<Object> asNamedList(Map<?, ?> named) {
    List<Object> items = new ArrayList<>(named.size());
    for (Map.Entry<?, ?> entry : named.entrySet()) {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("name", entry.getKey());
      if (entry.getValue() instanceof Map<?, ?> value) {
        value.forEach((k, v) -> item.put(String.valueOf(k), v));
      }
      items.add(item);
    }
    return items;
  }

  /** The inverse of {@link #asNamedList}: an array of named items keyed back by name. */
  private static Map<String, Object> asNamedMap(List<?> items) {
    Map<String, Object> named = new LinkedHashMap<>();
    for (Object item : items) {
      if (!(item instanceof Map<?, ?> map) || !(map.get("name") instanceof String name)) {
        return named;
      }
      Map<String, Object> value = new LinkedHashMap<>();
      map.forEach(
          (k, v) -> {
            if (!"name".equals(k)) {
              value.put(String.valueOf(k), v);
            }
          });
      named.put(name, value);
    }
    return named;
  }

  private static String describe(Object value) {
    return value == null ? "null" : value.getClass().getSimpleName() + " " + value;
  }

  /**
   * Report whether a saved value carries nothing, which a vector writes as {@code null}.
   *
   * <p>An empty list or map counts as absent. Optional collections are materialized by the
   * generated models, so a field the wire never supplied still saves as an empty collection rather
   * than disappearing; treating that as a difference would fail every vector that states an optional
   * collection as null. A collection with entries in it is a real difference and is not absent, and
   * an empty string is a value rather than an absence.
   */
  private static boolean isAbsent(Object value) {
    if (value == null) {
      return true;
    }
    if (value instanceof Collection<?> collection) {
      return collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return map.isEmpty();
    }
    return false;
  }

  // ---------------------------------------------------------------- error matching

  /**
   * Assert that {@code actual} reports the failure a vector describes.
   *
   * <p>Vectors name errors loosely — "FileNotFoundError", "invalid frontmatter" — because exact
   * wording is a runtime's own business and pinning it would make the shared vectors unusable. The
   * match is therefore on meaning rather than text, but it requires <em>every</em> significant word
   * of the expectation to appear: matching on any one shared word would let "invalid template" pass
   * a vector that asked for "invalid frontmatter".
   */
  public static void assertErrorMatches(String label, String expected, Throwable actual) {
    if (actual == null) {
      fail(label + ": expected an error matching \"" + expected + "\", but the call succeeded");
    }
    String message = actual.getMessage() == null ? "" : actual.getMessage().toLowerCase(Locale.ROOT);
    String wanted = expected.toLowerCase(Locale.ROOT);

    if (wanted.contains("filenotfounderror")) {
      boolean matched =
          actual instanceof LoadException load && load.kind() == LoadException.Kind.FILE_NOT_FOUND;
      assertTrue(matched || message.contains("not found"), label + ": expected a not-found error, got " + actual);
      return;
    }

    if (message.contains(wanted)) {
      return;
    }

    // Every distinguishing word must be present. Short words ("not", "set") and the generic
    // "error" carry no signal, so they are not required — but they are not sufficient either.
    List<String> required = new ArrayList<>();
    for (String word : wanted.split("\\W+")) {
      if (word.length() > 3 && !word.equals("error")) {
        required.add(word);
      }
    }
    if (!required.isEmpty()) {
      boolean all = true;
      for (String word : required) {
        if (!message.contains(word)) {
          all = false;
          break;
        }
      }
      if (all) {
        return;
      }
    }

    fail(label + ": expected an error matching \"" + expected + "\", got \"" + actual.getMessage() + "\"");
  }
}
