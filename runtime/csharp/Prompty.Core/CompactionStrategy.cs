// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Context compaction strategy for replacing default dropped-message summaries
/// with higher-quality LLM-powered or function-based summaries.
/// </summary>
public abstract class CompactionStrategy
{
    /// <summary>Produce a compact summary from dropped messages.</summary>
    public abstract Task<string> CompactAsync(IReadOnlyList<Message> dropped);

    /// <summary>Create compaction from a .prompty file path.</summary>
    public static CompactionStrategy FromPrompty(string path) => new PromptyCompaction(path);

    /// <summary>Create compaction from a function.</summary>
    public static CompactionStrategy FromFunction(Func<IReadOnlyList<Message>, Task<string>> fn) => new FunctionCompaction(fn);
}

internal sealed class PromptyCompaction : CompactionStrategy
{
    private readonly string _path;

    public PromptyCompaction(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        _path = path;
    }

    public override async Task<string> CompactAsync(IReadOnlyList<Message> dropped)
    {
        var text = ContextWindow.FormatDroppedMessages(dropped.ToList());
        var result = await Pipeline.InvokeAsync(_path, new Dictionary<string, object?> { ["messages"] = text });
        return result?.ToString() ?? "";
    }
}

internal sealed class FunctionCompaction : CompactionStrategy
{
    private readonly Func<IReadOnlyList<Message>, Task<string>> _fn;

    public FunctionCompaction(Func<IReadOnlyList<Message>, Task<string>> fn)
    {
        ArgumentNullException.ThrowIfNull(fn);
        _fn = fn;
    }

    public override Task<string> CompactAsync(IReadOnlyList<Message> dropped) => _fn(dropped);
}
