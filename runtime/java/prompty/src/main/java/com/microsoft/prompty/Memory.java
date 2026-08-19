package com.microsoft.prompty;

import com.microsoft.prompty.model.MemoryCategory;
import com.microsoft.prompty.model.MemoryEntry;
import com.microsoft.prompty.model.MemoryStore;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * Agent memory: tiered recall, formatting, and mutation over the generated memory contract.
 *
 * <p>The data types are generated; what a runtime must not reinvent is what the data <em>means</em>.
 * That is what lives here — ranking, injection, eviction — so a host is left owning only
 * persistence, and every runtime agrees on which memory a query should surface.
 *
 * <p>Memory is tiered. A {@link MemoryCategory#CORE} memory is a persistent fact: injected into
 * every system prompt, replaced on write when an identical tag set restates it, and boosted during
 * recall. A {@link MemoryCategory#ARCHIVAL} memory is a compressed summary, surfaced only through
 * recall and the first thing evicted when the store is full. A {@link MemoryCategory#INSIGHT}
 * memory is a saved reflection, surfaced through recall.
 *
 * <p>Associating a memory with a session, a user, or a project is host convention expressed through
 * the general {@code tags} field, not engine logic.
 *
 * <p>These operations mutate the store in place, because Java cannot add methods to the generated
 * type the way the reference runtime can.
 */
public final class Memory {

  private Memory() {}

  /** A recalled memory paired with the score that ranked it. */
  public record Scored(MemoryEntry entry, double score, int keywordMatches) {}

  /**
   * Host-owned persistence for a whole-store snapshot.
   *
   * <p>Deliberately whole-store rather than per-entry: a host that persists entries individually
   * has to reason about ordering, which is exactly the deterministic logic this module owns.
   */
  public interface Port {
    MemoryStore load();

    void save(MemoryStore store);
  }

  /** Append a memory with no tier policy applied. */
  public static void add(MemoryStore store, MemoryEntry entry) {
    store.entries.add(entry);
  }

  /**
   * Insert a memory applying tier policy.
   *
   * <p>A restated core fact replaces the old one rather than accumulating beside it, which is what
   * keeps an always-injected tier from growing without bound. Identity for that purpose is the tag
   * set, since that is what a host uses to scope a fact.
   *
   * <p>A {@code maxEntries} of {@code 0} means no cap.
   */
  public static void remember(MemoryStore store, MemoryEntry entry, int maxEntries) {
    if (entry.category == MemoryCategory.CORE) {
      store.entries.removeIf(
          existing -> existing.category == MemoryCategory.CORE && tagsEqual(existing.tags, entry.tags));
    }
    store.entries.add(entry);
    evictToCap(store, maxEntries);
  }

  /**
   * Evict until the store holds at most {@code maxEntries}, and report how many went.
   *
   * <p>Archival memories go first because they are summaries of things already said; only when
   * there are none does the oldest memory of any tier go. A {@code maxEntries} of {@code 0} means
   * no cap and evicts nothing.
   */
  public static int evictToCap(MemoryStore store, int maxEntries) {
    if (maxEntries <= 0) {
      return 0;
    }
    int evicted = 0;
    while (store.entries.size() > maxEntries) {
      int victim = 0;
      for (int i = 0; i < store.entries.size(); i++) {
        if (store.entries.get(i).category == MemoryCategory.ARCHIVAL) {
          victim = i;
          break;
        }
      }
      store.entries.remove(victim);
      evicted++;
    }
    return evicted;
  }

  /** Replace the memory at {@code index}. */
  public static void update(MemoryStore store, int index, MemoryEntry entry) {
    requireIndex(store, index);
    store.entries.set(index, entry);
  }

  /** Replace only the content at {@code index}, preserving category, timestamp, and tags. */
  public static void updateContent(MemoryStore store, int index, String content) {
    requireIndex(store, index);
    store.entries.get(index).content = content;
  }

  /** Remove and return the memory at {@code index}. */
  public static MemoryEntry remove(MemoryStore store, int index) {
    requireIndex(store, index);
    return store.entries.remove(index);
  }

  /** Remove memories in {@code category}, or every memory when it is null, and report how many. */
  public static int clear(MemoryStore store, MemoryCategory category) {
    int before = store.entries.size();
    if (category == null) {
      store.entries.clear();
    } else {
      store.entries.removeIf(entry -> entry.category == category);
    }
    return before - store.entries.size();
  }

  /** The core memories, in insertion order. */
  public static List<MemoryEntry> coreMemories(MemoryStore store) {
    List<MemoryEntry> core = new ArrayList<>();
    for (MemoryEntry entry : store.entries) {
      if (entry.category == MemoryCategory.CORE) {
        core.add(entry);
      }
    }
    return core;
  }

  /**
   * Recall the most relevant memories for {@code query}.
   *
   * <p>Ranking is lexical and dependency-free, so it produces the same order in every runtime and
   * on every machine. A keyword found in the content is worth 2; found in the tags it is worth 3,
   * because tags were chosen deliberately and content merely happens to contain the word. A core
   * memory that matched at all gets a further 1, being the always-relevant tier. Ties fall back to
   * insertion order.
   *
   * <p>A query with no keywords returns everything in insertion order at score 0; a {@code limit}
   * of {@code 0} returns every match. A host wanting embedding-based recall keeps the vectors in
   * its own storage and does that itself.
   */
  public static List<Scored> recall(MemoryStore store, String query, int limit) {
    List<String> tokens = queryTokens(query);
    boolean hasQuery = !tokens.isEmpty();

    List<Scored> scored = new ArrayList<>();
    for (MemoryEntry entry : store.entries) {
      double[] result = scoreEntry(entry, tokens);
      int matches = (int) result[1];
      if (hasQuery && matches == 0) {
        continue;
      }
      scored.add(new Scored(entry, result[0], matches));
    }

    // List.sort is contractually stable, which is what keeps equal scores in insertion order.
    scored.sort(Comparator.comparingDouble(Scored::score).reversed());

    return limit > 0 && scored.size() > limit ? List.copyOf(scored.subList(0, limit)) : scored;
  }

  /**
   * Format the core memories as a block for injection into a system prompt.
   *
   * <p>Returns an empty string when there are none, so a host can inject conditionally without
   * first asking. Only core memories are injected; the other tiers reach the model through recall.
   */
  public static String formatForSystemPrompt(MemoryStore store) {
    List<MemoryEntry> core = coreMemories(store);
    if (core.isEmpty()) {
      return "";
    }
    StringBuilder out = new StringBuilder("## Memory\n");
    for (MemoryEntry entry : core) {
      out.append("- ").append(entry.content).append('\n');
    }
    return out.toString();
  }

  /**
   * Format a recall result set for presentation, e.g. to show which memories informed a response.
   *
   * <p>Returns an empty string for an empty result set.
   */
  public static String formatRecallResults(List<Scored> results) {
    if (results.isEmpty()) {
      return "";
    }
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < results.size(); i++) {
      Scored scored = results.get(i);
      out.append(i + 1)
          .append(". [")
          .append(scored.entry().category.value)
          .append("] ")
          .append(scored.entry().content)
          .append('\n');
      List<String> tags = scored.entry().tags;
      if (tags != null && !tags.isEmpty()) {
        out.append("   tags: ").append(String.join(", ", tags)).append('\n');
      }
    }
    return out.toString();
  }

  private static void requireIndex(MemoryStore store, int index) {
    if (index < 0 || index >= store.entries.size()) {
      throw new IndexOutOfBoundsException(
          "memory index " + index + " out of bounds (len " + store.entries.size() + ")");
    }
  }

  /** Whether two tag lists carry the same tags, treating an absent list and an empty one as equal. */
  private static boolean tagsEqual(List<String> left, List<String> right) {
    List<String> a = left == null ? List.of() : left;
    List<String> b = right == null ? List.of() : right;
    return Objects.equals(a, b);
  }

  private static List<String> queryTokens(String query) {
    List<String> tokens = new ArrayList<>();
    if (query == null) {
      return tokens;
    }
    for (String raw : query.split("\\s+")) {
      String token = trimNonAlphanumeric(raw).toLowerCase(Locale.ROOT);
      if (!token.isEmpty() && !tokens.contains(token)) {
        tokens.add(token);
      }
    }
    return tokens;
  }

  private static String trimNonAlphanumeric(String value) {
    int start = 0;
    int end = value.length();
    while (start < end && !Character.isLetterOrDigit(value.charAt(start))) {
      start++;
    }
    while (end > start && !Character.isLetterOrDigit(value.charAt(end - 1))) {
      end--;
    }
    return value.substring(start, end);
  }

  /** Returns {@code [weightedScore, distinctMatches]}; both are zero for an empty query. */
  private static double[] scoreEntry(MemoryEntry entry, List<String> tokens) {
    if (tokens.isEmpty()) {
      return new double[] {0.0, 0};
    }
    String content = entry.content == null ? "" : entry.content.toLowerCase(Locale.ROOT);
    List<String> tags = new ArrayList<>();
    if (entry.tags != null) {
      for (String tag : entry.tags) {
        tags.add(tag == null ? "" : tag.toLowerCase(Locale.ROOT));
      }
    }

    double weighted = 0.0;
    int distinct = 0;
    for (String token : tokens) {
      boolean inContent = content.contains(token);
      boolean inTags = tags.stream().anyMatch(tag -> tag.contains(token));
      if (inContent || inTags) {
        distinct++;
      }
      if (inContent) {
        weighted += 2.0;
      }
      if (inTags) {
        weighted += 3.0;
      }
    }
    if (weighted > 0.0 && entry.category == MemoryCategory.CORE) {
      weighted += 1.0;
    }
    return new double[] {weighted, distinct};
  }
}
