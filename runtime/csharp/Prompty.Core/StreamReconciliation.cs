// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Outcome of reconciling a classified stream-chunk sequence into the
/// streaming-failure contract asserted by the <c>Processor.processStream</c> vectors.
/// </summary>
public sealed class StreamReconciliation(string partialText, bool requiresReconciliation, bool completionCommitted)
{
    /// <summary>The concatenation of every text chunk emitted before a terminal failure.</summary>
    public string PartialText { get; } = partialText;

    /// <summary>Whether any terminal failure is indeterminate (provider outcome unknown).</summary>
    public bool RequiresReconciliation { get; } = requiresReconciliation;

    /// <summary>Whether the stream terminated with no failure at all.</summary>
    public bool CompletionCommitted { get; } = completionCommitted;

    /// <summary>Serialize to the canonical processStream wire shape.</summary>
    public Dictionary<string, object?> Save() => new()
    {
        ["partialText"] = PartialText,
        ["requiresReconciliation"] = RequiresReconciliation,
        ["completionCommitted"] = CompletionCommitted,
    };

    /// <summary>
    /// Reconcile classified stream chunks into a <see cref="StreamReconciliation"/>.
    ///
    /// Partial text is the concatenation of every text chunk emitted before a terminal
    /// failure. A stream requires reconciliation when any terminal failure is
    /// indeterminate. A completion is committed only when the stream terminates with no
    /// failure at all.
    /// </summary>
    public static StreamReconciliation Reconcile(IEnumerable<StreamChunk> chunks)
    {
        var materialized = chunks.ToList();
        var partialText = string.Concat(materialized.OfType<TextChunk>().Select(c => c.Value));
        var failures = materialized.OfType<FailureChunk>().ToList();
        var requiresReconciliation = failures.Any(f => f.Failure.Outcome == StreamFailureOutcome.Indeterminate);
        var completionCommitted = failures.Count == 0;
        return new StreamReconciliation(partialText, requiresReconciliation, completionCommitted);
    }
}
