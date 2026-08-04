package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.opentest4j.AssertionFailedError;

/**
 * Covers the vector harness itself.
 *
 * <p>Every provider suite is only as trustworthy as the comparison behind it, and a comparison that
 * silently accepts everything would let all of them pass while the runtimes disagreed. These tests
 * exist so the assertions used to grade cross-runtime agreement are themselves graded.
 */
class SpecVectorsTest {

  private static void equivalent(Object expected, Object actual) {
    SpecVectors.assertEquivalent("test", expected, actual);
  }

  private static void rejects(Object expected, Object actual) {
    assertThrows(AssertionFailedError.class, () -> equivalent(expected, actual));
  }

  @Test
  void anExtraFieldTheVectorDoesNotDescribeIsRejected() {
    // The whole point of the exact comparison: a runtime that adds a field to every request must
    // not be able to do so without a single vector noticing.
    rejects(Map.of("model", "gpt-4"), Map.of("model", "gpt-4", "surprise", true));
  }

  @Test
  void anExtraFieldNestedInsideAnObjectIsAlsoRejected() {
    rejects(
        Map.of("options", Map.of("temperature", 1)),
        Map.of("options", Map.of("temperature", 1, "surprise", true)));
  }

  @Test
  void anExtraFieldInsideAnArrayElementIsAlsoRejected() {
    rejects(
        Map.of("messages", List.of(Map.of("role", "user"))),
        Map.of("messages", List.of(Map.of("role", "user", "surprise", true))));
  }

  @Test
  void aMissingFieldIsRejected() {
    rejects(Map.of("model", "gpt-4", "stream", true), Map.of("model", "gpt-4"));
  }

  @Test
  void aFieldTheVectorStatesAsNullMustStillBePresent() {
    // The subset matcher accepts an absent key wherever the vector states an explicit null, so
    // without a key-set check this is exactly the case that slips through: the reference
    // implementation compares key counts and would reject it.
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("model", "gpt-4");
    expected.put("response_format", null);
    rejects(expected, Map.of("model", "gpt-4"));
  }

  @Test
  void aNullFieldNestedInsideAnArrayElementMustAlsoBePresent() {
    Map<String, Object> block = new LinkedHashMap<>();
    block.put("type", "text");
    block.put("cache_control", null);
    rejects(
        Map.of("content", List.of(block)),
        Map.of("content", List.of(Map.of("type", "text"))));
  }

  @Test
  void anExactMatchIsAccepted() {
    equivalent(
        Map.of("model", "gpt-4", "messages", List.of(Map.of("role", "user", "content", "hi"))),
        Map.of("model", "gpt-4", "messages", List.of(Map.of("role", "user", "content", "hi"))));
  }

  @Test
  void keyOrderDoesNotMatter() {
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("a", 1);
    expected.put("b", 2);
    Map<String, Object> actual = new LinkedHashMap<>();
    actual.put("b", 2);
    actual.put("a", 1);
    equivalent(expected, actual);
  }

  @Test
  void numbersCompareByValueRatherThanByBoxedType() {
    // JSON has one number type; the runtimes store them at whatever width the schema declares.
    equivalent(Map.of("max_tokens", 4096), Map.of("max_tokens", 4096L));
  }

  @Test
  void anExpectedNullAssertsTheFieldIsAbsent() {
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("response_format", null);
    SpecVectors.assertMatches("test", expected, new LinkedHashMap<String, Object>());
  }

  @Test
  void theSubsetMatchStillIgnoresFieldsTheVectorDoesNotMention() {
    // assertMatches keeps its looser contract, which is what lets a load vector describe one corner
    // of a prompt without restating the whole thing.
    SpecVectors.assertMatches("test", Map.of("model", "gpt-4"), Map.of("model", "gpt-4", "x", 1));
  }

  @Test
  void anExpectedNullIsSatisfiedByAnEmptyCollection() {
    // The generated models materialize optional collections, so a `tools` the wire never supplied
    // arrives as an empty list and saves as `[]` rather than vanishing. The reference runtimes do
    // the same — Rust inserts the saved collection unconditionally and C# guards only on non-null —
    // so a vector stating `"tools": null` has to accept it, exactly as Rust's `as_tools()` and
    // Python's length check do.
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("tools", null);

    SpecVectors.assertMatches("test", expected, Map.of("tools", List.of()));
    SpecVectors.assertMatches("test", expected, Map.of("tools", Map.of()));
  }

  @Test
  void anExpectedNullIsStillRejectedByACollectionThatHasEntries() {
    // The relaxation must not reach a collection carrying real content: that is a runtime emitting
    // something the vector says should not be there, which is the defect this comparison exists to
    // catch.
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("tools", null);

    assertThrows(
        AssertionFailedError.class,
        () -> SpecVectors.assertMatches("test", expected, Map.of("tools", List.of("search"))));
    assertThrows(
        AssertionFailedError.class,
        () -> SpecVectors.assertMatches("test", expected, Map.of("tools", Map.of("a", 1))));
  }

  @Test
  void anExpectedNullIsStillRejectedByAnEmptyString() {
    // An empty string is a value, not an absence. A runtime that sends `""` where the vector says
    // nothing should be sent is disagreeing, and widening absence to cover it would hide that.
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("instructions", null);

    assertThrows(
        AssertionFailedError.class,
        () -> SpecVectors.assertMatches("test", expected, Map.of("instructions", "")));
  }

  @Test
  void theKeySetCheckIsNotRelaxedByTheEmptyCollectionAllowance() {
    // assertEquivalent still rejects a key the vector never mentions, even when the value is an
    // empty collection. Only an explicit `null` in the vector opts into the allowance; a vector that
    // omits the key entirely is still asserting the field is not sent at all.
    rejects(Map.of("model", "gpt-4"), Map.of("model", "gpt-4", "tools", List.of()));
  }
}
