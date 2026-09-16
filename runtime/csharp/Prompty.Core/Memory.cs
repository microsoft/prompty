#nullable enable

using System.Text;
using System.Linq;

namespace Prompty.Core;

public sealed record ScoredMemory(MemoryEntry Entry, double Score, int KeywordMatches);

public interface IMemoryPort
{
    MemoryStore Load();

    void Save(MemoryStore store);
}

public static class Memory
{
    public static void Add(MemoryStore store, MemoryEntry entry) => store.Entries.Add(entry);

    public static void Remember(MemoryStore store, MemoryEntry entry, int maxEntries = 0)
    {
        if (entry.Category == MemoryCategory.Core)
        {
            store.Entries = store.Entries
                .Where(existing => existing.Category != MemoryCategory.Core || !TagsEqual(existing.Tags, entry.Tags))
                .ToList();
        }

        store.Entries.Add(entry);
        EvictToCap(store, maxEntries);
    }

    public static int EvictToCap(MemoryStore store, int maxEntries)
    {
        if (maxEntries <= 0)
            return 0;

        var evicted = 0;
        while (store.Entries.Count > maxEntries)
        {
            var victim = 0;
            for (var i = 0; i < store.Entries.Count; i++)
            {
                if (store.Entries[i].Category == MemoryCategory.Archival)
                {
                    victim = i;
                    break;
                }
            }

            store.Entries.RemoveAt(victim);
            evicted++;
        }

        return evicted;
    }

    public static void Update(MemoryStore store, int index, MemoryEntry entry)
    {
        RequireIndex(store, index);
        store.Entries[index] = entry;
    }

    public static void UpdateContent(MemoryStore store, int index, string content)
    {
        RequireIndex(store, index);
        store.Entries[index].Content = content;
    }

    public static MemoryEntry Remove(MemoryStore store, int index)
    {
        RequireIndex(store, index);
        var entry = store.Entries[index];
        store.Entries.RemoveAt(index);
        return entry;
    }

    public static int Clear(MemoryStore store, MemoryCategory? category = null)
    {
        var before = store.Entries.Count;
        if (category is null)
        {
            store.Entries.Clear();
        }
        else
        {
            store.Entries = store.Entries.Where(entry => entry.Category != category).ToList();
        }

        return before - store.Entries.Count;
    }

    public static IReadOnlyList<MemoryEntry> CoreMemories(MemoryStore store) =>
        store.Entries.Where(entry => entry.Category == MemoryCategory.Core).ToList();

    public static IReadOnlyList<ScoredMemory> Recall(MemoryStore store, string? query, int limit = 0)
    {
        var tokens = QueryTokens(query);
        var hasQuery = tokens.Count > 0;
        var scored = new List<ScoredMemory>();

        foreach (var entry in store.Entries)
        {
            var (score, matches) = ScoreEntry(entry, tokens);
            if (hasQuery && matches == 0)
                continue;
            scored.Add(new ScoredMemory(entry, score, matches));
        }

        scored = scored.OrderByDescending(item => item.Score).ToList();
        return limit > 0 && scored.Count > limit ? scored.Take(limit).ToList() : scored;
    }

    public static string FormatForSystemPrompt(MemoryStore store)
    {
        var core = CoreMemories(store);
        if (core.Count == 0)
            return string.Empty;

        var output = new StringBuilder("## Memory\n");
        foreach (var entry in core)
        {
            output.Append("- ").Append(entry.Content).Append('\n');
        }

        return output.ToString();
    }

    public static string FormatRecallResults(IEnumerable<ScoredMemory> results)
    {
        var output = new StringBuilder();
        var index = 0;
        foreach (var result in results)
        {
            index++;
            output
                .Append(index)
                .Append(". [")
                .Append(MemoryCategoryParser.ToValue(result.Entry.Category))
                .Append("] ")
                .Append(result.Entry.Content)
                .Append('\n');

            if (result.Entry.Tags is { Count: > 0 })
            {
                output.Append("   tags: ").Append(string.Join(", ", result.Entry.Tags)).Append('\n');
            }
        }

        return output.ToString();
    }

    private static void RequireIndex(MemoryStore store, int index)
    {
        if (index < 0 || index >= store.Entries.Count)
            throw new ArgumentOutOfRangeException(nameof(index), $"memory index {index} out of bounds (len {store.Entries.Count})");
    }

    private static bool TagsEqual(IList<string>? left, IList<string>? right)
    {
        var a = left ?? [];
        var b = right ?? [];
        return a.SequenceEqual(b);
    }

    private static List<string> QueryTokens(string? query)
    {
        var tokens = new List<string>();
        foreach (var token in (query ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(raw => TrimNonAlphanumeric(raw).ToLowerInvariant())
            .Where(token => token.Length > 0))
        {
            if (!tokens.Contains(token))
            {
                tokens.Add(token);
            }
        }

        return tokens;
    }

    private static string TrimNonAlphanumeric(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && !char.IsLetterOrDigit(value[start]))
            start++;
        while (end > start && !char.IsLetterOrDigit(value[end - 1]))
            end--;
        return value[start..end];
    }

    private static (double Score, int Matches) ScoreEntry(MemoryEntry entry, IReadOnlyList<string> tokens)
    {
        if (tokens.Count == 0)
            return (0, 0);

        var content = (entry.Content ?? string.Empty).ToLowerInvariant();
        var tags = (entry.Tags ?? []).Select(tag => tag.ToLowerInvariant()).ToList();
        var score = 0.0;
        var matches = 0;

        foreach (var token in tokens)
        {
            var inContent = content.Contains(token, StringComparison.Ordinal);
            var inTags = tags.Any(tag => tag.Contains(token, StringComparison.Ordinal));
            if (inContent || inTags)
                matches++;
            if (inContent)
                score += 2;
            if (inTags)
                score += 3;
        }

        if (score > 0 && entry.Category == MemoryCategory.Core)
            score += 1;

        return (score, matches);
    }
}
