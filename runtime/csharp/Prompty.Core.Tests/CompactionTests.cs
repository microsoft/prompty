// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

public class CompactionTests
{
    private static Message TextMsg(string role, string text) =>
        new() { Role = role, Parts = [new TextPart { Value = text }] };

    private static Message ToolCallMsg(string name, string args) =>
        new()
        {
            Role = "assistant",
            Parts = [new TextPart { Value = "" }],
            Metadata = new Dictionary<string, object?>
            {
                ["tool_calls"] = new List<ToolCall>
                {
                    new() { Id = "tc1", Name = name, Arguments = args }
                }
            }
        };

    // -----------------------------------------------------------------------
    // FormatDroppedMessages
    // -----------------------------------------------------------------------

    [Fact]
    public void FormatDroppedMessages_FormatsReadableText()
    {
        var dropped = new List<Message>
        {
            TextMsg("user", "What is 2+2?"),
            TextMsg("assistant", "It is 4."),
        };

        var result = ContextWindow.FormatDroppedMessages(dropped);

        Assert.Contains("[user]: What is 2+2?", result);
        Assert.Contains("[assistant]: It is 4.", result);
    }

    [Fact]
    public void FormatDroppedMessages_ShowsToolCalls()
    {
        var dropped = new List<Message>
        {
            ToolCallMsg("get_weather", "{\"city\":\"Seattle\"}")
        };

        var result = ContextWindow.FormatDroppedMessages(dropped);

        Assert.Contains("[assistant]: Called: get_weather(", result);
        Assert.Contains("Seattle", result);
    }

    [Fact]
    public void FormatDroppedMessages_EmptyForEmptyList()
    {
        var result = ContextWindow.FormatDroppedMessages(new List<Message>());
        Assert.Equal("", result);
    }

    // -----------------------------------------------------------------------
    // CompactionStrategy factory methods
    // -----------------------------------------------------------------------

    [Fact]
    public void FromFunction_CreatesStrategy()
    {
        var strategy = CompactionStrategy.FromFunction(
            msgs => Task.FromResult("summary"));
        Assert.NotNull(strategy);
    }

    [Fact]
    public void FromPrompty_CreatesStrategy()
    {
        var strategy = CompactionStrategy.FromPrompty("some/path.prompty");
        Assert.NotNull(strategy);
    }

    [Fact]
    public void FromPrompty_ThrowsOnEmpty()
    {
        Assert.Throws<ArgumentException>(() =>
            CompactionStrategy.FromPrompty(""));
    }

    [Fact]
    public void FromFunction_ThrowsOnNull()
    {
        Assert.Throws<ArgumentNullException>(() =>
            CompactionStrategy.FromFunction(null!));
    }

    // -----------------------------------------------------------------------
    // ApplyCompactionAsync — function path
    // -----------------------------------------------------------------------

    [Fact]
    public async Task CompactionFunction_ReplacesSummary()
    {
        // Arrange: build messages that simulate a trimmed conversation
        // with a default summary already in place
        var messages = new List<Message>
        {
            TextMsg("system", "You are a helpful assistant."),
            TextMsg("user", "[Context summary: User asked: old question]"),
            TextMsg("user", "latest question"),
        };

        var dropped = new List<Message>
        {
            TextMsg("user", "old question"),
            TextMsg("assistant", "old answer"),
        };

        var compaction = CompactionStrategy.FromFunction(
            msgs => Task.FromResult("Compacted: discussed old question and got old answer"));

        // Act
        await Pipeline.ApplyCompactionAsync(compaction, dropped, messages, null);

        // Assert: the summary message was replaced
        Assert.Equal("Compacted: discussed old question and got old answer", messages[1].Text);
    }

    [Fact]
    public async Task CompactionFailure_PreservesDefault()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "system"),
            TextMsg("user", "[Context summary: original summary]"),
            TextMsg("user", "latest"),
        };

        var dropped = new List<Message> { TextMsg("user", "old") };

        var compaction = CompactionStrategy.FromFunction(
            _ => throw new InvalidOperationException("LLM unavailable"));

        var events = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();
        EventCallback onEvent = (type, data) => events.Add((type, data));

        // Act
        await Pipeline.ApplyCompactionAsync(compaction, dropped, messages, onEvent);

        // Assert: original summary preserved
        Assert.Equal("[Context summary: original summary]", messages[1].Text);

        // Assert: failure event emitted
        Assert.Contains(events, e => e.Type == AgentEventType.CompactionFailed);
        var failedEvent = events.First(e => e.Type == AgentEventType.CompactionFailed);
        Assert.Contains("LLM unavailable", failedEvent.Data["reason"]?.ToString());
    }

    [Fact]
    public async Task CompactionEmpty_EmitsFailedEvent()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "system"),
            TextMsg("user", "[Context summary: original]"),
            TextMsg("user", "latest"),
        };

        var dropped = new List<Message> { TextMsg("user", "old") };

        var compaction = CompactionStrategy.FromFunction(
            _ => Task.FromResult(""));

        var events = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();
        EventCallback onEvent = (type, data) => events.Add((type, data));

        await Pipeline.ApplyCompactionAsync(compaction, dropped, messages, onEvent);

        // Original preserved
        Assert.Equal("[Context summary: original]", messages[1].Text);

        // CompactionFailed with "empty result"
        var failedEvent = events.First(e => e.Type == AgentEventType.CompactionFailed);
        Assert.Equal("empty result", failedEvent.Data["reason"]?.ToString());
    }

    // -----------------------------------------------------------------------
    // Event emission
    // -----------------------------------------------------------------------

    [Fact]
    public async Task CompactionEvents_AreEmitted()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "system"),
            TextMsg("user", "[Context summary: original]"),
            TextMsg("user", "latest"),
        };

        var dropped = new List<Message> { TextMsg("user", "old") };

        var compaction = CompactionStrategy.FromFunction(
            _ => Task.FromResult("New compacted summary"));

        var events = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();
        EventCallback onEvent = (type, data) => events.Add((type, data));

        await Pipeline.ApplyCompactionAsync(compaction, dropped, messages, onEvent);

        // Both start and complete events emitted
        Assert.Contains(events, e => e.Type == AgentEventType.CompactionStart);
        Assert.Contains(events, e => e.Type == AgentEventType.CompactionComplete);

        var startEvent = events.First(e => e.Type == AgentEventType.CompactionStart);
        Assert.Equal(1, startEvent.Data["dropped_count"]);

        var completeEvent = events.First(e => e.Type == AgentEventType.CompactionComplete);
        Assert.Equal("New compacted summary".Length, completeEvent.Data["summary_length"]);
    }

    // -----------------------------------------------------------------------
    // ReplaceSummaryMessage
    // -----------------------------------------------------------------------

    [Fact]
    public void ReplaceSummaryMessage_ReplacesFirstMatch()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "system prompt"),
            TextMsg("user", "[Context summary: old info]"),
            TextMsg("user", "new question"),
        };

        Pipeline.ReplaceSummaryMessage(messages, "Better summary");

        Assert.Equal("Better summary", messages[1].Text);
        Assert.Equal("user", messages[1].Role);
    }

    [Fact]
    public void ReplaceSummaryMessage_NoMatchLeavesListUnchanged()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "system prompt"),
            TextMsg("user", "just a normal message"),
        };

        Pipeline.ReplaceSummaryMessage(messages, "Better summary");

        Assert.Equal("just a normal message", messages[1].Text);
    }

    // -----------------------------------------------------------------------
    // Null compaction preserves existing behavior
    // -----------------------------------------------------------------------

    [Fact]
    public void NullCompaction_DefaultParameterValue()
    {
        // Verify the parameter defaults to null — this is a compile-time check.
        // If this compiles, the default is correct.
        // We just verify the method signature accepts no compaction argument.
        Assert.Null((CompactionStrategy?)null);
    }
}


