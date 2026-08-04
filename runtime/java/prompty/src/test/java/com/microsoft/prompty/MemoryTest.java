package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.MemoryCategory;
import com.microsoft.prompty.model.MemoryEntry;
import com.microsoft.prompty.model.MemoryStore;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Grades tiered recall, injection, and eviction against the reference runtime's rules. */
class MemoryTest {

  private static MemoryEntry entry(String content, MemoryCategory category, String... tags) {
    MemoryEntry memory = new MemoryEntry();
    memory.content = content;
    memory.category = category;
    memory.tags = tags.length == 0 ? null : new ArrayList<>(List.of(tags));
    return memory;
  }

  private static MemoryStore storeOf(MemoryEntry... entries) {
    MemoryStore store = new MemoryStore();
    store.entries = new ArrayList<>(List.of(entries));
    return store;
  }

  private static List<String> contents(List<Memory.Scored> results) {
    return results.stream().map(scored -> scored.entry().content).toList();
  }

  @Test
  void tagMatchesOutrankContentMatches() {
    MemoryStore store =
        storeOf(
            entry("the deploy pipeline runs nightly", MemoryCategory.ARCHIVAL),
            entry("nothing relevant here", MemoryCategory.ARCHIVAL, "deploy"));

    List<Memory.Scored> results = Memory.recall(store, "deploy", 0);

    assertEquals(List.of("nothing relevant here", "the deploy pipeline runs nightly"), contents(results));
    assertEquals(3.0, results.get(0).score(), 1e-9, "a tag hit is worth 3");
    assertEquals(2.0, results.get(1).score(), 1e-9, "a content hit is worth 2");
  }

  @Test
  void coreMemoriesGetABoostOnlyWhenTheyMatch() {
    MemoryStore store =
        storeOf(
            entry("deploy on fridays", MemoryCategory.CORE),
            entry("deploy on mondays", MemoryCategory.ARCHIVAL));

    List<Memory.Scored> results = Memory.recall(store, "deploy", 0);

    assertEquals(3.0, results.get(0).score(), 1e-9, "content hit plus the core boost");
    assertEquals(2.0, results.get(1).score(), 1e-9);

    // A core memory that matched nothing is not surfaced at all, so the boost cannot lift it.
    assertTrue(Memory.recall(store, "unrelated", 0).isEmpty());
  }

  @Test
  void aMemoryMatchingBothContentAndTagsScoresBoth() {
    MemoryStore store = storeOf(entry("deploy nightly", MemoryCategory.CORE, "deploy"));

    Memory.Scored only = Memory.recall(store, "deploy", 0).get(0);

    assertEquals(6.0, only.score(), 1e-9, "2 content + 3 tag + 1 core");
    assertEquals(1, only.keywordMatches(), "one distinct keyword matched, however many ways");
  }

  @Test
  void tiesFallBackToInsertionOrder() {
    MemoryStore store =
        storeOf(
            entry("deploy first", MemoryCategory.ARCHIVAL),
            entry("deploy second", MemoryCategory.ARCHIVAL),
            entry("deploy third", MemoryCategory.ARCHIVAL));

    assertEquals(
        List.of("deploy first", "deploy second", "deploy third"),
        contents(Memory.recall(store, "deploy", 0)));
  }

  @Test
  void queryTokensAreNormalizedAndDeduplicated() {
    MemoryStore store = storeOf(entry("Deploy the service", MemoryCategory.ARCHIVAL));

    // Case, surrounding punctuation, and a repeat of the same word must not change the score.
    assertEquals(2.0, Memory.recall(store, "DEPLOY", 0).get(0).score(), 1e-9);
    assertEquals(2.0, Memory.recall(store, "(deploy)", 0).get(0).score(), 1e-9);
    assertEquals(2.0, Memory.recall(store, "deploy deploy", 0).get(0).score(), 1e-9);
    assertEquals(4.0, Memory.recall(store, "deploy service", 0).get(0).score(), 1e-9);
  }

  @Test
  void anEmptyQueryReturnsEverythingUnranked() {
    MemoryStore store =
        storeOf(
            entry("first", MemoryCategory.CORE),
            entry("second", MemoryCategory.ARCHIVAL));

    for (String query : new String[] {"", "   ", "!!!", null}) {
      List<Memory.Scored> results = Memory.recall(store, query, 0);
      assertEquals(List.of("first", "second"), contents(results), "query: " + query);
      assertEquals(0.0, results.get(0).score(), 1e-9);
    }
  }

  @Test
  void limitCapsResultsAndZeroMeansUnlimited() {
    MemoryStore store =
        storeOf(
            entry("deploy one", MemoryCategory.ARCHIVAL),
            entry("deploy two", MemoryCategory.ARCHIVAL),
            entry("deploy three", MemoryCategory.ARCHIVAL));

    assertEquals(2, Memory.recall(store, "deploy", 2).size());
    assertEquals(3, Memory.recall(store, "deploy", 0).size());
    assertEquals(3, Memory.recall(store, "deploy", 99).size());
  }

  @Test
  void rememberReplacesACoreFactWithTheSameTags() {
    MemoryStore store = storeOf();
    Memory.remember(store, entry("prefers tabs", MemoryCategory.CORE, "style"), 0);
    Memory.remember(store, entry("prefers spaces", MemoryCategory.CORE, "style"), 0);

    assertEquals(1, store.entries.size(), "a restated fact replaces rather than accumulates");
    assertEquals("prefers spaces", store.entries.get(0).content);
  }

  @Test
  void rememberKeepsCoreFactsScopedByDifferentTags() {
    MemoryStore store = storeOf();
    Memory.remember(store, entry("prefers tabs", MemoryCategory.CORE, "style"), 0);
    Memory.remember(store, entry("deploys on friday", MemoryCategory.CORE, "process"), 0);

    assertEquals(2, store.entries.size(), "different scopes are different facts");
  }

  @Test
  void anAbsentTagListEqualsAnEmptyOne() {
    MemoryStore store = storeOf();
    MemoryEntry untagged = entry("first", MemoryCategory.CORE);
    MemoryEntry emptyTags = entry("second", MemoryCategory.CORE);
    emptyTags.tags = new ArrayList<>();

    Memory.remember(store, untagged, 0);
    Memory.remember(store, emptyTags, 0);

    assertEquals(1, store.entries.size(), "no tags and empty tags are the same scope");
    assertEquals("second", store.entries.get(0).content);
  }

  @Test
  void rememberOnlyDeduplicatesCoreMemories() {
    MemoryStore store = storeOf();
    Memory.remember(store, entry("first summary", MemoryCategory.ARCHIVAL, "session"), 0);
    Memory.remember(store, entry("second summary", MemoryCategory.ARCHIVAL, "session"), 0);

    assertEquals(2, store.entries.size(), "archival memories accumulate");
  }

  @Test
  void evictionTakesArchivalMemoriesFirst() {
    MemoryStore store =
        storeOf(
            entry("core fact", MemoryCategory.CORE),
            entry("old summary", MemoryCategory.ARCHIVAL),
            entry("an insight", MemoryCategory.INSIGHT));

    assertEquals(1, Memory.evictToCap(store, 2));
    assertEquals(
        List.of("core fact", "an insight"),
        store.entries.stream().map(memory -> memory.content).toList(),
        "the summary goes before anything else");
  }

  @Test
  void evictionFallsBackToTheOldestWhenNothingIsArchival() {
    MemoryStore store =
        storeOf(
            entry("oldest", MemoryCategory.CORE),
            entry("middle", MemoryCategory.INSIGHT),
            entry("newest", MemoryCategory.CORE));

    assertEquals(2, Memory.evictToCap(store, 1));
    assertEquals(List.of("newest"), store.entries.stream().map(memory -> memory.content).toList());
  }

  @Test
  void aZeroCapMeansNoCap() {
    MemoryStore store =
        storeOf(entry("a", MemoryCategory.ARCHIVAL), entry("b", MemoryCategory.ARCHIVAL));

    assertEquals(0, Memory.evictToCap(store, 0));
    assertEquals(2, store.entries.size());

    Memory.remember(store, entry("c", MemoryCategory.ARCHIVAL), 0);
    assertEquals(3, store.entries.size(), "remember respects an uncapped store");
  }

  @Test
  void rememberEnforcesTheCap() {
    MemoryStore store = storeOf();
    for (String content : List.of("a", "b", "c", "d")) {
      Memory.remember(store, entry(content, MemoryCategory.ARCHIVAL), 2);
    }

    assertEquals(List.of("c", "d"), store.entries.stream().map(memory -> memory.content).toList());
  }

  @Test
  void mutationHelpersActOnTheRightEntry() {
    MemoryStore store =
        storeOf(entry("first", MemoryCategory.CORE, "keep"), entry("second", MemoryCategory.ARCHIVAL));

    Memory.updateContent(store, 0, "rewritten");
    assertEquals("rewritten", store.entries.get(0).content);
    assertEquals(List.of("keep"), store.entries.get(0).tags, "content-only edits preserve tags");
    assertEquals(MemoryCategory.CORE, store.entries.get(0).category);

    Memory.update(store, 1, entry("replaced", MemoryCategory.INSIGHT));
    assertEquals(MemoryCategory.INSIGHT, store.entries.get(1).category);

    assertEquals("replaced", Memory.remove(store, 1).content);
    assertEquals(1, store.entries.size());
  }

  @Test
  void mutationHelpersRejectAnOutOfRangeIndex() {
    MemoryStore store = storeOf(entry("only", MemoryCategory.CORE));

    assertThrows(IndexOutOfBoundsException.class, () -> Memory.remove(store, 1));
    assertThrows(IndexOutOfBoundsException.class, () -> Memory.remove(store, -1));
    assertThrows(IndexOutOfBoundsException.class, () -> Memory.updateContent(store, 5, "x"));
    assertEquals(1, store.entries.size(), "a rejected mutation changes nothing");
  }

  @Test
  void clearTargetsATierOrEverything() {
    MemoryStore store =
        storeOf(
            entry("core", MemoryCategory.CORE),
            entry("summary", MemoryCategory.ARCHIVAL),
            entry("another summary", MemoryCategory.ARCHIVAL));

    assertEquals(2, Memory.clear(store, MemoryCategory.ARCHIVAL));
    assertEquals(1, store.entries.size());
    assertEquals(1, Memory.clear(store, null));
    assertTrue(store.entries.isEmpty());
    assertEquals(0, Memory.clear(store, null), "clearing an empty store removes nothing");
  }

  @Test
  void onlyCoreMemoriesAreInjectedIntoTheSystemPrompt() {
    MemoryStore store =
        storeOf(
            entry("prefers tabs", MemoryCategory.CORE),
            entry("a summary", MemoryCategory.ARCHIVAL),
            entry("deploys on friday", MemoryCategory.CORE));

    assertEquals(
        "## Memory\n- prefers tabs\n- deploys on friday\n", Memory.formatForSystemPrompt(store));
  }

  @Test
  void anEmptyMemoryBlockIsOmittedEntirely() {
    assertEquals("", Memory.formatForSystemPrompt(storeOf()));
    assertEquals(
        "",
        Memory.formatForSystemPrompt(storeOf(entry("a summary", MemoryCategory.ARCHIVAL))),
        "a store with no core memories injects nothing rather than an empty heading");
  }

  @Test
  void recallResultsFormatWithTierAndTags() {
    MemoryStore store =
        storeOf(
            entry("deploy on friday", MemoryCategory.CORE, "process", "release"),
            entry("deploy notes", MemoryCategory.ARCHIVAL));

    assertEquals(
        "1. [core] deploy on friday\n   tags: process, release\n2. [archival] deploy notes\n",
        Memory.formatRecallResults(Memory.recall(store, "deploy", 0)));
    assertEquals("", Memory.formatRecallResults(List.of()));
  }

  @Test
  void addAppliesNoTierPolicy() {
    MemoryStore store = storeOf();
    Memory.add(store, entry("prefers tabs", MemoryCategory.CORE, "style"));
    Memory.add(store, entry("prefers spaces", MemoryCategory.CORE, "style"));

    assertEquals(2, store.entries.size(), "add is the escape hatch that does not deduplicate");
  }

  @Test
  void coreMemoriesArePreservedInInsertionOrder() {
    MemoryStore store =
        storeOf(
            entry("first", MemoryCategory.CORE),
            entry("summary", MemoryCategory.ARCHIVAL),
            entry("second", MemoryCategory.CORE));

    assertEquals(
        List.of("first", "second"),
        Memory.coreMemories(store).stream().map(memory -> memory.content).toList());
  }
}
