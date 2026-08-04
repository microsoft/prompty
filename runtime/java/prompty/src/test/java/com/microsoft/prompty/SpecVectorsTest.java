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
}
