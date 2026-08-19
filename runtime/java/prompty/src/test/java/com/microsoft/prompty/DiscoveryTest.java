package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.TypraJson;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Covers the shared capability dataset and the rule that applies it. */
class DiscoveryTest {

  @Nested
  @DisplayName("prefix matching")
  class PrefixMatching {

    @Test
    @DisplayName("a dated id matches its family at the separator")
    void datedIdMatchesFamily() {
      assertNotNull(Discovery.lookup("openai", "gpt-4-0613"));
    }

    @Test
    @DisplayName("the most specific family wins")
    void longestPrefixWins() {
      Discovery.Capabilities mini = Discovery.lookup("openai", "gpt-4o-mini-2024-07-18");
      assertNotNull(mini);
      assertEquals(128000, mini.contextWindow());
      // gpt-4 also prefixes this id but is shorter, and its window is different; if ordering were
      // wrong this would read 8192.
      assertEquals(List.of("text", "image"), mini.inputModalities());
    }

    @Test
    @DisplayName("a longer family name is not captured by a shorter one")
    void requiresATokenBoundary() {
      // The character after `gpt-4` is alphanumeric, so this is a different family and must not
      // inherit gpt-4's context window.
      assertNull(Discovery.lookup("openai", "gpt-45"));
      assertFalse(Discovery.prefixMatches("gpt-45", "gpt-4"));
      assertTrue(Discovery.prefixMatches("gpt-4", "gpt-4"));
      assertTrue(Discovery.prefixMatches("gpt-4.1", "gpt-4"));
    }

    @Test
    @DisplayName("an unknown id or provider has no entry")
    void unknownLookupsAreEmpty() {
      assertNull(Discovery.lookup("openai", "some-custom-model"));
      assertNull(Discovery.lookup("nonexistent", "gpt-4o"));
      assertNull(Discovery.lookup("openai", null));
    }

    @Test
    @DisplayName("an empty modality list is a real answer, not a missing one")
    void embeddingsDeclareNoOutputModality() {
      Discovery.Capabilities caps = Discovery.lookup("openai", "text-embedding-3-small");
      assertNotNull(caps);
      assertEquals(8191, caps.contextWindow());
      assertEquals(List.of(), caps.outputModalities());
    }
  }

  @Nested
  @DisplayName("enrichment")
  class Enrichment {

    @Test
    @DisplayName("empty fields are filled")
    void fillsMissingFields() {
      ModelInfo info = new ModelInfo();
      info.id = "gpt-4o";
      Discovery.enrich("openai", info);
      assertEquals(128000, info.contextWindow);
      assertEquals(List.of("text", "image"), info.inputModalities);
      assertEquals(List.of("text"), info.outputModalities);
    }

    @Test
    @DisplayName("what the provider supplied is never overwritten")
    void providerFieldsWin() {
      ModelInfo info = new ModelInfo();
      info.id = "gpt-4o";
      info.contextWindow = 999;
      info.inputModalities = new java.util.ArrayList<>(List.of("text"));
      Discovery.enrich("openai", info);
      assertEquals(999, info.contextWindow);
      assertEquals(List.of("text"), info.inputModalities);
      // Only the field left empty is filled.
      assertEquals(List.of("text"), info.outputModalities);
    }

    @Test
    @DisplayName("an empty list the provider chose to send still wins")
    void providerEmptyListWins() {
      ModelInfo info = new ModelInfo();
      info.id = "gpt-4o";
      info.inputModalities = new java.util.ArrayList<>();
      Discovery.enrich("openai", info);
      assertEquals(List.of(), info.inputModalities);
    }

    @Test
    @DisplayName("an unknown model is left alone")
    void unknownModelIsUntouched() {
      ModelInfo info = new ModelInfo();
      info.id = "ft:custom:user-123";
      Discovery.enrich("openai", info);
      assertNull(info.contextWindow);
      assertNull(info.inputModalities);
      assertNull(info.outputModalities);
    }

    @Test
    @DisplayName("a filled list is a copy, so the shared table cannot be mutated")
    void fillsWithACopy() {
      ModelInfo first = new ModelInfo();
      first.id = "gpt-4o";
      Discovery.enrich("openai", first);
      first.inputModalities.clear();

      ModelInfo second = new ModelInfo();
      second.id = "gpt-4o";
      Discovery.enrich("openai", second);
      assertEquals(List.of("text", "image"), second.inputModalities);
    }
  }

  @Test
  @DisplayName("the vendored dataset still matches the shared source")
  void vendoredCopyMatchesSpec() throws Exception {
    Path canonical = SpecVectors.repoRoot().resolve("spec/data/model_capabilities.json");
    if (!Files.exists(canonical)) {
      // Running from a published jar rather than a checkout; there is nothing to compare against.
      return;
    }

    String vendored;
    try (InputStream stream = Discovery.class.getResourceAsStream(Discovery.RESOURCE)) {
      assertNotNull(stream, "the vendored dataset is missing from the jar");
      vendored = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }

    assertEquals(
        TypraJson.parse(Files.readString(canonical)),
        TypraJson.parse(vendored),
        "runtime/java/prompty/src/main/resources/com/microsoft/prompty/model_capabilities.json has"
            + " drifted from spec/data/model_capabilities.json — re-copy the canonical file");
  }
}
