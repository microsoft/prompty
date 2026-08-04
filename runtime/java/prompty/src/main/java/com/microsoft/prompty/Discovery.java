package com.microsoft.prompty;

import com.microsoft.prompty.model.ModelInfo;
import com.microsoft.prompty.model.TypraJson;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Capability enrichment for provider model discovery.
 *
 * <p>Provider {@code /models} endpoints differ in how much they say. Anthropic and Foundry return
 * context windows and modalities; OpenAI returns little more than an id. Left alone, the same model
 * would describe itself differently depending on where it was listed from, so Prompty ships one
 * shared dataset and one rule for applying it:
 *
 * <blockquote>
 *
 * The provider always wins. Dataset entries fill only the fields the provider left empty, and a
 * model id is matched by its longest prefix.
 *
 * </blockquote>
 *
 * <p>The dataset is deliberately not emitted from TypeSpec. TypeSpec owns the shape of {@link
 * ModelInfo}; this is volatile vendor data — context windows and model families that change with
 * every release — kept as a refreshable snapshot.
 *
 * <p><b>Vendored copy.</b> The cross-runtime source of truth is {@code
 * spec/data/model_capabilities.json}. A published jar cannot reach outside its own tree, so this
 * module carries a copy on the classpath and {@code DiscoveryTest} fails if the two drift apart. To
 * refresh, edit the file under {@code spec/} and copy it to {@code
 * runtime/java/prompty/src/main/resources/com/microsoft/prompty/}. Every runtime vendors it the same
 * way, which is what lets the shared enrichment vectors converge.
 */
public final class Discovery {

  /** Where the vendored dataset sits on the classpath. */
  static final String RESOURCE = "/com/microsoft/prompty/model_capabilities.json";

  private Discovery() {}

  /**
   * The capability fields a dataset entry can supply.
   *
   * <p>Every field is nullable, and null means the dataset says nothing — leave whatever the
   * provider returned. That is distinct from an empty modality list, which is a real answer: an
   * embedding model genuinely produces no output modality.
   */
  public record Capabilities(
      Integer contextWindow, List<String> inputModalities, List<String> outputModalities) {}

  private record Entry(String prefix, Capabilities capabilities) {}

  /** Parsed once on first use; the dataset is immutable for the life of the process. */
  private static final class Table {
    static final Map<String, List<Entry>> BY_PROVIDER = parse();

    private static Map<String, List<Entry>> parse() {
      Map<String, List<Entry>> providers = new HashMap<>();
      Object parsed = TypraJson.parse(read());
      if (!(parsed instanceof Map<?, ?> root)) {
        return providers;
      }
      if (!(root.get("providers") instanceof Map<?, ?> map)) {
        return providers;
      }
      for (Map.Entry<?, ?> provider : map.entrySet()) {
        if (!(provider.getValue() instanceof Iterable<?> list)) {
          continue;
        }
        List<Entry> entries = new ArrayList<>();
        for (Object item : list) {
          Entry entry = toEntry(item);
          if (entry != null) {
            entries.add(entry);
          }
        }
        // Longest prefix first, so the first match is the most specific one and the order the file
        // happens to be authored in cannot change the answer.
        entries.sort(Comparator.comparingInt((Entry e) -> e.prefix().length()).reversed());
        providers.put(String.valueOf(provider.getKey()), List.copyOf(entries));
      }
      return Map.copyOf(providers);
    }

    private static Entry toEntry(Object item) {
      if (!(item instanceof Map<?, ?> map) || !(map.get("prefix") instanceof String prefix)) {
        return null;
      }
      return new Entry(
          prefix,
          new Capabilities(
              map.get("contextWindow") instanceof Number n ? n.intValue() : null,
              modalities(map.get("inputModalities")),
              modalities(map.get("outputModalities"))));
    }

    private static List<String> modalities(Object value) {
      if (!(value instanceof Iterable<?> items)) {
        return null;
      }
      List<String> result = new ArrayList<>();
      for (Object item : items) {
        if (item instanceof String text) {
          result.add(text);
        }
      }
      return List.copyOf(result);
    }

    private static String read() {
      try (InputStream stream = Discovery.class.getResourceAsStream(RESOURCE)) {
        if (stream == null) {
          throw new IllegalStateException("missing vendored capability dataset at " + RESOURCE);
        }
        return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
      } catch (IOException e) {
        throw new IllegalStateException("unable to read " + RESOURCE, e);
      }
    }
  }

  /**
   * Find the dataset entry for a model id, or null when the provider has none.
   *
   * <p>Matching is by longest prefix, and only at a token boundary — see {@link #prefixMatches}.
   */
  public static Capabilities lookup(String provider, String id) {
    List<Entry> entries = Table.BY_PROVIDER.get(provider == null ? "" : provider);
    if (entries == null || id == null) {
      return null;
    }
    for (Entry entry : entries) {
      if (prefixMatches(id, entry.prefix())) {
        return entry.capabilities();
      }
    }
    return null;
  }

  /**
   * Whether a dataset prefix claims a model id.
   *
   * <p>A prefix matches only at a token boundary: the id must either be the prefix exactly, or the
   * next character must be a separator. Without that rule {@code gpt-4} would swallow a future
   * {@code gpt-45} and hand it the wrong context window, while the ids that should match — {@code
   * gpt-4-0613}, {@code gpt-4o-2024-05-13} — still do. Every runtime implements this same rule, so
   * the shared enrichment vectors agree.
   */
  static boolean prefixMatches(String id, String prefix) {
    if (!id.startsWith(prefix)) {
      return false;
    }
    if (id.length() == prefix.length()) {
      return true;
    }
    char next = id.charAt(prefix.length());
    boolean alphanumeric =
        (next >= '0' && next <= '9')
            || (next >= 'a' && next <= 'z')
            || (next >= 'A' && next <= 'Z');
    return !alphanumeric;
  }

  /**
   * Fill a model's empty capability fields from the shared dataset.
   *
   * <p>Only fields the provider left null are written; anything it supplied stands, including an
   * empty list it chose to send. A dataset entry that is itself an empty list is a legitimate fill —
   * that is how an embedding model's absent output modality is expressed.
   */
  public static void enrich(String provider, ModelInfo info) {
    if (info == null) {
      return;
    }
    Capabilities caps = lookup(provider, info.id);
    if (caps == null) {
      return;
    }
    if (info.contextWindow == null && caps.contextWindow() != null) {
      info.contextWindow = caps.contextWindow();
    }
    if (info.inputModalities == null && caps.inputModalities() != null) {
      info.inputModalities = new ArrayList<>(caps.inputModalities());
    }
    if (info.outputModalities == null && caps.outputModalities() != null) {
      info.outputModalities = new ArrayList<>(caps.outputModalities());
    }
  }
}
