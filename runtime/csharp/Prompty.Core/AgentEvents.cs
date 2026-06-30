// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>§13.1 Agent loop event types.</summary>
public enum AgentEventType
{
    TurnStart,
    TurnEnd,
    LlmStart,
    LlmComplete,
    Retry,
    PermissionRequested,
    PermissionCompleted,
    Token,
    Thinking,
    ToolCallStart,
    ToolCallComplete,
    ToolResult,
    Status,
    MessagesUpdated,
    Done,
    Error,
    Cancelled,
    CompactionStart,
    CompactionComplete,
    CompactionFailed
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
            var eventData = new Dictionary<string, object?>(data)
            {
                ["turnEvent"] = new Dictionary<string, object?>
                {
                    ["id"] = $"evt_{Guid.NewGuid():N}",
                    ["type"] = ToWireName(eventType),
                    ["timestamp"] = DateTimeOffset.UtcNow.ToString("O"),
                    ["iteration"] = data.TryGetValue("iteration", out var iteration) ? iteration : null,
                    ["payload"] = data,
                },
            };
            callback(eventType, eventData);
        }
        catch (Exception ex)
        {
            // Swallow — event callbacks must not break the loop (§13.1)
            System.Diagnostics.Debug.WriteLine($"Event callback error for {eventType}: {ex.Message}");
        }
    }

    private static string ToWireName(AgentEventType eventType) => eventType switch
    {
        AgentEventType.TurnStart => "turn_start",
        AgentEventType.TurnEnd => "turn_end",
        AgentEventType.LlmStart => "llm_start",
        AgentEventType.LlmComplete => "llm_complete",
        AgentEventType.Retry => "retry",
        AgentEventType.PermissionRequested => "permission_requested",
        AgentEventType.PermissionCompleted => "permission_completed",
        AgentEventType.ToolCallStart => "tool_call_start",
        AgentEventType.ToolCallComplete => "tool_call_complete",
        AgentEventType.ToolResult => "tool_result",
        AgentEventType.MessagesUpdated => "messages_updated",
        AgentEventType.CompactionStart => "compaction_start",
        AgentEventType.CompactionComplete => "compaction_complete",
        AgentEventType.CompactionFailed => "compaction_failed",
        _ => eventType.ToString().ToLowerInvariant(),
    };
}
