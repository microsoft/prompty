// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core.Tracing;

namespace Prompty.Core;

/// <summary>
/// Wraps a raw async stream of chunks with accumulation and tracing.
/// Per spec §10.1: accumulates items, flushes trace on exhaustion.
/// </summary>
public class PromptyStream : IAsyncEnumerable<object>
{
    private readonly IAsyncEnumerable<object> _raw;
    private readonly List<object> _items = [];

    public PromptyStream(IAsyncEnumerable<object> raw)
    {
        _raw = raw;
    }

    /// <summary>Accumulated items after iteration completes.</summary>
    public IReadOnlyList<object> Items => _items;

    public async IAsyncEnumerator<object> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        await foreach (var item in _raw.WithCancellation(cancellationToken))
        {
            _items.Add(item);
            yield return item;
        }

        // On exhaustion: emit trace span with accumulated items
        if (Tracer.HasListeners)
        {
            using var emitter = Tracer.Start("PromptyStream");
            emitter.Emit("result", TraceSerializer.ToDict(_items.Select(i => i?.ToString()).ToList()));
        }
    }
}
