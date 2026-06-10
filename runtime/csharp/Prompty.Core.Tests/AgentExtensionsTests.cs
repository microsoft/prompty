// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// ──────────────────────────────────────────
//  AgentEvents
// ──────────────────────────────────────────

public class AgentEventsTests
{
    [Fact]
    public void EmitEvent_CallsCallback_WithCorrectArgs()
    {
        AgentEventType? captured = null;
        Dictionary<string, object?>? capturedData = null;

        EventCallback cb = (et, d) =>
        {
            captured = et;
            capturedData = d;
        };

        var data = new Dictionary<string, object?> { ["key"] = "value" };
        AgentEvents.EmitEvent(cb, AgentEventType.ToolCallStart, data);

        Assert.Equal(AgentEventType.ToolCallStart, captured);
        Assert.NotNull(capturedData);
        Assert.Equal("value", capturedData["key"]);
        var turnEvent = Assert.IsType<Dictionary<string, object?>>(capturedData["turnEvent"]);
        Assert.IsType<string>(turnEvent["id"]);
        Assert.Equal("tool_call_start", turnEvent["type"]);
        Assert.IsType<string>(turnEvent["timestamp"]);
        Assert.Same(data, turnEvent["payload"]);
    }

    [Fact]
    public void EmitEvent_SwallowsCallbackExceptions()
    {
        EventCallback cb = (_, _) => throw new InvalidOperationException("boom");

        var ex = Record.Exception(() =>
            AgentEvents.EmitEvent(cb, AgentEventType.Error, new Dictionary<string, object?>()));

        Assert.Null(ex);
    }

    [Fact]
    public void EmitEvent_NoOp_WhenCallbackIsNull()
    {
        var ex = Record.Exception(() =>
            AgentEvents.EmitEvent(null, AgentEventType.Done, new Dictionary<string, object?>()));

        Assert.Null(ex);
    }

    [Fact]
    public void EmitEvent_AllEventTypes_Dispatch()
    {
        var received = new List<AgentEventType>();
        EventCallback cb = (et, _) => received.Add(et);

        foreach (var et in Enum.GetValues<AgentEventType>())
            AgentEvents.EmitEvent(cb, et, new Dictionary<string, object?>());

        Assert.Equal(Enum.GetValues<AgentEventType>().Length, received.Count);
    }
}

// ──────────────────────────────────────────
//  Steering
// ──────────────────────────────────────────

public class SteeringTests
{
    [Fact]
    public void Send_Drain_ReturnsMessages()
    {
        var steering = new Steering();
        steering.Send("hello");

        var messages = steering.Drain();

        Assert.Single(messages);
        Assert.Equal(Role.User, messages[0].Role);
        Assert.IsType<TextPart>(messages[0].Parts[0]);
        Assert.Equal("hello", ((TextPart)messages[0].Parts[0]).Value);
    }

    [Fact]
    public void Drain_EmptiesQueue()
    {
        var steering = new Steering();
        steering.Send("one");
        steering.Send("two");

        var first = steering.Drain();
        var second = steering.Drain();

        Assert.Equal(2, first.Count);
        Assert.Empty(second);
    }

    [Fact]
    public void HasPending_ReflectsQueueState()
    {
        var steering = new Steering();

        Assert.False(steering.HasPending);

        steering.Send("test");
        Assert.True(steering.HasPending);

        steering.Drain();
        Assert.False(steering.HasPending);
    }

    [Fact]
    public void MultipleSends_DrainInOrder()
    {
        var steering = new Steering();
        steering.Send("first");
        steering.Send("second");
        steering.Send("third");

        var messages = steering.Drain();

        Assert.Equal(3, messages.Count);
        Assert.Equal("first", ((TextPart)messages[0].Parts[0]).Value);
        Assert.Equal("second", ((TextPart)messages[1].Parts[0]).Value);
        Assert.Equal("third", ((TextPart)messages[2].Parts[0]).Value);
    }
}

// ──────────────────────────────────────────
//  ContextWindow
// ──────────────────────────────────────────

public class ContextWindowTests
{
    private static Message TextMsg(string role, string text) =>
        new() { Role = Enum.Parse<Role>(role, true), Parts = [new TextPart { Value = text }] };

    [Fact]
    public void EstimateChars_CountsTextParts()
    {
        var messages = new List<Message> { TextMsg("user", "hello") };

        int estimate = ContextWindow.EstimateChars(messages);

        // "user".Length + 4 + "hello".Length = 4 + 4 + 5 = 13
        Assert.Equal(13, estimate);
    }

    [Fact]
    public void EstimateChars_NonTextPartsAdd200()
    {
        var msg = new Message
        {
            Role = Role.User,
            Parts = [new ImagePart { Source = "data:image/png;base64,abc" }]
        };
        var messages = new List<Message> { msg };

        int estimate = ContextWindow.EstimateChars(messages);

        // "user".Length + 4 + 200 = 208
        Assert.Equal(208, estimate);
    }

    [Fact]
    public void SummarizeDropped_CreatesUserSummary()
    {
        var messages = new List<Message> { TextMsg("user", "What is 2+2?") };

        var summary = ContextWindow.SummarizeDropped(messages);

        Assert.Contains("Context summary", summary);
        Assert.Contains("User asked:", summary);
        Assert.Contains("What is 2+2?", summary);
    }

    [Fact]
    public void SummarizeDropped_EmptyForEmptyList()
    {
        var summary = ContextWindow.SummarizeDropped(new List<Message>());
        Assert.Equal("", summary);
    }

    [Fact]
    public void TrimToContextWindow_NoTrimWhenWithinBudget()
    {
        var messages = new List<Message> { TextMsg("user", "hi") };
        int budget = 10_000;

        var (droppedCount, dropped) = ContextWindow.TrimToContextWindow(messages, budget);

        Assert.Equal(0, droppedCount);
        Assert.Empty(dropped);
        Assert.Single(messages);
    }

    [Fact]
    public void TrimToContextWindow_DropsOldestNonSystemMessages()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "You are a helpful assistant."),
            TextMsg("user", new string('a', 500)),
            TextMsg("assistant", new string('b', 500)),
            TextMsg("user", new string('c', 500)),
            TextMsg("assistant", new string('d', 500)),
            TextMsg("user", "latest question"),
            TextMsg("assistant", "latest answer"),
        };

        // Set a budget small enough that some messages must be dropped
        // but large enough to keep system + at least last 2
        int budget = 300;

        var (droppedCount, dropped) = ContextWindow.TrimToContextWindow(messages, budget);

        Assert.True(droppedCount > 0);
        Assert.NotEmpty(dropped);
    }

    [Fact]
    public void TrimToContextWindow_PreservesSystemMessages()
    {
        var messages = new List<Message>
        {
            TextMsg("system", "System prompt."),
            TextMsg("user", new string('x', 1000)),
            TextMsg("assistant", new string('y', 1000)),
            TextMsg("user", "last"),
            TextMsg("assistant", "end"),
        };

        int budget = 200;

        ContextWindow.TrimToContextWindow(messages, budget);

        // System message should always be first
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("System prompt.", ((TextPart)messages[0].Parts[0]).Value);
    }
}

// ──────────────────────────────────────────
//  Guardrails
// ──────────────────────────────────────────

public class GuardrailsTests
{
    [Fact]
    public void NoHooks_AlwaysAllowed()
    {
        var guard = new Guardrails();

        var inputResult = guard.CheckInput(new List<Message>());
        var outputResult = guard.CheckOutput(new Message { Role = Role.Assistant, Parts = [] });
        var toolResult = guard.CheckTool("tool", new Dictionary<string, object?>());

        Assert.True(inputResult.Allowed);
        Assert.True(outputResult.Allowed);
        Assert.True(toolResult.Allowed);
    }

    [Fact]
    public void CheckInput_CallsInputHook()
    {
        List<Message>? capturedMessages = null;
        var guard = new Guardrails(
            input: msgs => { capturedMessages = msgs; return new GuardrailResult(false, "blocked"); });

        var messages = new List<Message>
        {
            new() { Role = Role.User, Parts = [new TextPart { Value = "test" }] }
        };

        var result = guard.CheckInput(messages);

        Assert.False(result.Allowed);
        Assert.Equal("blocked", result.Reason);
        Assert.Same(messages, capturedMessages);
    }

    [Fact]
    public void CheckOutput_CallsOutputHook()
    {
        Message? capturedMessage = null;
        var guard = new Guardrails(
            output: msg => { capturedMessage = msg; return new GuardrailResult(true); });

        var msg = new Message { Role = Role.Assistant, Parts = [new TextPart { Value = "response" }] };

        var result = guard.CheckOutput(msg);

        Assert.True(result.Allowed);
        Assert.Same(msg, capturedMessage);
    }

    [Fact]
    public void CheckTool_CallsToolHook()
    {
        string? capturedName = null;
        Dictionary<string, object?>? capturedArgs = null;
        var guard = new Guardrails(
            tool: (name, args) =>
            {
                capturedName = name;
                capturedArgs = args;
                return new GuardrailResult(false, "tool not allowed");
            });

        var args = new Dictionary<string, object?> { ["city"] = "Seattle" };

        var result = guard.CheckTool("get_weather", args);

        Assert.False(result.Allowed);
        Assert.Equal("tool not allowed", result.Reason);
        Assert.Equal("get_weather", capturedName);
        Assert.Same(args, capturedArgs);
    }

    [Fact]
    public void GuardrailError_HasCorrectReason()
    {
        var error = new GuardrailError("content policy violation");

        Assert.Equal("content policy violation", error.Reason);
        Assert.Contains("content policy violation", error.Message);
        Assert.IsAssignableFrom<Exception>(error);
    }
}
