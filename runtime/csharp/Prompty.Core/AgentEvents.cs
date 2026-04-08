// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>§13.1 Agent loop event types.</summary>
public enum AgentEventType
{
    Token,
    Thinking,
    ToolCallStart,
    ToolResult,
    Status,
    MessagesUpdated,
    Done,
    Error,
    Cancelled
}

/// <summary>Callback for agent loop events.</summary>
public delegate void EventCallback(AgentEventType eventType, Dictionary<string, object?> data);

/// <summary>Safe event emission helpers.</summary>
public static class AgentEvents
{
    /// <summary>
    /// Emit an event safely. Swallows exceptions from callback
    /// (spec §13.1: event callbacks MUST NOT block the loop).
    /// </summary>
    public static void EmitEvent(EventCallback? callback, AgentEventType eventType, Dictionary<string, object?> data)
    {
        if (callback is null) return;
        try
        {
            callback(eventType, data);
        }
        catch (Exception ex)
        {
            // Swallow — event callbacks must not break the loop (§13.1)
            System.Diagnostics.Debug.WriteLine($"Event callback error for {eventType}: {ex.Message}");
        }
    }
}
