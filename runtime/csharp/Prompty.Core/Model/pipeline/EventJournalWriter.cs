// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Persists typed events to a durable replay journal.
/// </summary>
public interface IEventJournalWriter
{
    /// <summary>
    /// Append a turn event to a durable replay journal
    /// </summary>
    bool AppendTurn(TurnEvent turnEvent);
    /// <summary>
    /// Append a session event to a durable replay journal
    /// </summary>
    bool AppendSession(SessionEvent sessionEvent);
    /// <summary>
    /// Finalize the journal with an optional session summary
    /// </summary>
    bool Close(SessionSummary? summary);
}
