// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Persists typed events to a replayable trace.
/// </summary>
public interface ITraceWriter
{
    /// <summary>
    /// Append a turn event to a replayable trace
    /// </summary>
    bool AppendTurn(TurnEvent turnEvent);
    /// <summary>
    /// Append a session event to a replayable trace
    /// </summary>
    bool AppendSession(SessionEvent sessionEvent);
    /// <summary>
    /// Finalize the trace with an optional session summary
    /// </summary>
    bool Close(SessionSummary? summary);
}
