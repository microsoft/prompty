// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>§13.3 Context window management — trimming and summarization.</summary>
public static class ContextWindow
{
    /// <summary>Estimate the character cost of a message list.</summary>
    public static int EstimateChars(List<Message> messages)
    {
        int total = 0;
        foreach (var msg in messages)
        {
            total += msg.Role.Length + 4;
            foreach (var part in msg.Parts)
            {
                if (part is TextPart tp)
                    total += tp.Value.Length;
                else
                    total += 200;
            }
            if (msg.Metadata is not null && msg.Metadata.TryGetValue("tool_calls", out var tc) && tc is not null)
                total += System.Text.Json.JsonSerializer.Serialize(tc).Length;
        }
        return total;
    }

    /// <summary>Build a compact string summary from dropped messages.</summary>
    public static string SummarizeDropped(List<Message> messages)
    {
        var lines = new List<string>();
        foreach (var msg in messages)
        {
            var msgText = msg.Text.Trim();
            if (msg.Role == "user" && msgText.Length > 0)
                lines.Add($"User asked: {Truncate(msgText)}");
            else if (msg.Role == "assistant")
            {
                if (msg.Metadata is not null && msg.Metadata.TryGetValue("tool_calls", out var toolCalls) && toolCalls is System.Collections.IEnumerable tcList)
                {
                    var names = new List<string>();
                    foreach (var tc in tcList)
                    {
                        var nameProp = tc?.GetType().GetProperty("Name")?.GetValue(tc)?.ToString();
                        if (nameProp is not null) names.Add(nameProp);
                    }
                    if (names.Count > 0)
                        lines.Add($"Assistant called: {string.Join(", ", names)}");
                    else if (msgText.Length > 0)
                        lines.Add($"Assistant: {Truncate(msgText)}");
                }
                else if (msgText.Length > 0)
                    lines.Add($"Assistant: {Truncate(msgText)}");
            }
        }
        if (lines.Count == 0) return "";

        var result = "[Context summary: ";
        foreach (var line in lines)
        {
            if (result.Length + line.Length > 4000)
            {
                result += "\n... (older messages omitted)";
                break;
            }
            result += line + "\n";
        }
        return result.TrimEnd() + "]";
    }

    /// <summary>
    /// Trim messages in-place to fit within a character budget.
    /// Returns (droppedCount, droppedMessages).
    /// </summary>
    public static (int DroppedCount, List<Message> Dropped) TrimToContextWindow(
        List<Message> messages, int budgetChars)
    {
        if (EstimateChars(messages) <= budgetChars)
            return (0, new List<Message>());

        int systemEnd = 0;
        for (int i = 0; i < messages.Count; i++)
        {
            if (messages[i].Role != "system")
            {
                systemEnd = i;
                break;
            }
            if (i == messages.Count - 1) systemEnd = messages.Count;
        }

        var systemMsgs = messages.GetRange(0, systemEnd);
        var rest = messages.GetRange(systemEnd, messages.Count - systemEnd);
        int summaryBudget = Math.Min(5000, (int)(budgetChars * 0.05));
        var dropped = new List<Message>();

        while (EstimateChars(new List<Message>(systemMsgs.Concat(rest))) > budgetChars - summaryBudget && rest.Count > 2)
        {
            dropped.Add(rest[0]);
            rest.RemoveAt(0);
        }

        int droppedCount = dropped.Count;
        messages.Clear();
        messages.AddRange(systemMsgs);

        if (droppedCount > 0)
        {
            var summaryText = SummarizeDropped(dropped);
            if (summaryText.Length > 0)
                messages.Add(new Message
                {
                    Role = "user",
                    Parts = [new TextPart { Value = summaryText }]
                });
        }

        messages.AddRange(rest);
        return (droppedCount, dropped);
    }

    /// <summary>
    /// Format dropped messages as readable text for compaction input.
    /// Each message is rendered as "[role]: text" with tool calls shown as "Called: name(args)".
    /// </summary>
    public static string FormatDroppedMessages(List<Message> messages)
    {
        var lines = new List<string>();
        foreach (var msg in messages)
        {
            if (msg.Metadata is not null && msg.Metadata.TryGetValue("tool_calls", out var toolCalls) && toolCalls is System.Collections.IEnumerable tcList)
            {
                foreach (var tc in tcList)
                {
                    var name = tc?.GetType().GetProperty("Name")?.GetValue(tc)?.ToString() ?? "unknown";
                    var args = tc?.GetType().GetProperty("Arguments")?.GetValue(tc)?.ToString() ?? "";
                    lines.Add($"[{msg.Role}]: Called: {name}({args})");
                }
            }

            var text = msg.Text.Trim();
            if (text.Length > 0)
                lines.Add($"[{msg.Role}]: {text}");
        }
        return string.Join("\n", lines);
    }

    private static string Truncate(string text, int maxLen = 200)
        => text.Length <= maxLen ? text : text[..maxLen] + "…";
}
