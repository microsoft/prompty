// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Receives typed turn and session events from a harness.
/// </summary>
public interface IEventSink
{
    /// <summary>
    /// Emit a typed turn event to a host sink
    /// </summary>
    bool EmitTurn(TurnEvent turnEvent);
    /// <summary>
    /// Emit a typed session event to a host sink
    /// </summary>
    bool EmitSession(SessionEvent sessionEvent);
}
