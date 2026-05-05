// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Anthropic.Tests;

/// <summary>
/// Shared helpers for creating test agents and messages.
/// </summary>
internal static class TestHelpers
{
    /// <summary>
    /// Create a minimal agent for testing with the given configuration.
    /// </summary>
    internal static Core.Prompty CreateAgent(
        string provider = "openai",
        string? apiType = "chat",
        string modelId = "gpt-4",
        string? apiKey = "test-key",
        string? endpoint = null,
        ModelOptions? options = null,
        IList<Tool>? tools = null,
        IList<Property>? outputs = null)
    {
        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "key",
            ["apiKey"] = apiKey ?? "",
        };

        if (endpoint is not null)
            connectionDict["endpoint"] = endpoint;

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = modelId,
            ["provider"] = provider,
        };

        if (apiType is not null)
            modelDict["apiType"] = apiType;

        modelDict["connection"] = connectionDict;

        var data = new Dictionary<string, object?>
        {
            ["name"] = "test-agent",
            ["model"] = modelDict,
        };

        var agent = Core.Prompty.Load(data, new LoadContext());

        if (options is not null && agent.Model is not null)
            agent.Model.Options = options;
        if (tools is not null)
            agent.Tools = tools;
        if (outputs is not null)
            agent.Outputs = outputs;

        return agent;
    }

    /// <summary>
    /// Create a simple text message.
    /// </summary>
    internal static Message CreateMessage(Role role, string text)
    {
        return new Message
        {
            Role = role,
            Parts = [new TextPart { Value = text }],
        };
    }

    /// <summary>
    /// Create a message with text and image parts.
    /// </summary>
    internal static Message CreateMultipartMessage(Role role, string text, string imageUrl, string? detail = null)
    {
        return new Message
        {
            Role = role,
            Parts =
            [
                new TextPart { Value = text },
                new ImagePart { Source = imageUrl, Detail = detail },
            ],
        };
    }

    /// <summary>
    /// Create an assistant message with tool calls in metadata.
    /// </summary>
    internal static Message CreateAssistantWithToolCalls(string text, List<ToolCall> toolCalls)
    {
        return new Message
        {
            Role = Role.Assistant,
            Parts = [new TextPart { Value = text }],
            Metadata = new Dictionary<string, object>
            {
                ["tool_calls"] = toolCalls,
            },
        };
    }

    /// <summary>
    /// Create a tool result message.
    /// </summary>
    internal static Message CreateToolMessage(string toolCallId, string content)
    {
        return new Message
        {
            Role = Role.Tool,
            Parts = [new TextPart { Value = content }],
            Metadata = new Dictionary<string, object>
            {
                ["tool_call_id"] = toolCallId,
            },
        };
    }

    /// <summary>
    /// Create a FunctionTool via the Tool.Load dispatch mechanism.
    /// </summary>
    internal static FunctionTool CreateFunctionTool(
        string name,
        string? description = null,
        IList<Property>? parameters = null,
        bool? strict = null)
    {
        var tool = new FunctionTool
        {
            Name = name,
            Kind = "function",
            Description = description,
        };

        if (parameters is not null)
            tool.Parameters = parameters;
        if (strict is not null)
            tool.Strict = strict;

        return tool;
    }
}
