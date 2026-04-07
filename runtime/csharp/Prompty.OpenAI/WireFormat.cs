// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using OpenAI.Chat;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Shared helpers for converting Prompty types to OpenAI SDK wire format.
/// Used by both OpenAI and Foundry providers.
/// </summary>
public static class WireFormat
{
    /// <summary>
    /// Convert a Prompty Message to an OpenAI ChatMessage.
    /// </summary>
    public static ChatMessage MessageToWire(Message msg)
    {
        var content = msg.ToTextContent();

        return msg.Role switch
        {
            Roles.System => new SystemChatMessage(msg.Text),
            Roles.Developer => new DeveloperChatMessage(msg.Text),
            Roles.User => content switch
            {
                string text => new UserChatMessage(text),
                _ => new UserChatMessage(BuildContentParts(msg.Parts)),
            },
            Roles.Assistant => BuildAssistantMessage(msg),
            Roles.Tool => new ToolChatMessage(
                msg.Metadata.TryGetValue("tool_call_id", out var id) ? id?.ToString() ?? "" : "",
                msg.Text),
            _ => new UserChatMessage(msg.Text),
        };
    }

    private static IEnumerable<ChatMessageContentPart> BuildContentParts(List<ContentPart> parts)
    {
        foreach (var part in parts)
        {
            switch (part)
            {
                case TextPart t:
                    yield return ChatMessageContentPart.CreateTextPart(t.Value);
                    break;
                case ImagePart i:
                    yield return ChatMessageContentPart.CreateImagePart(
                        new Uri(i.Source),
                        i.Detail switch
                        {
                            "high" => ChatImageDetailLevel.High,
                            "low" => ChatImageDetailLevel.Low,
                            _ => ChatImageDetailLevel.Auto,
                        });
                    break;
            }
        }
    }

    private static AssistantChatMessage BuildAssistantMessage(Message msg)
    {
        var assistant = new AssistantChatMessage(msg.Text);

        // Attach tool calls from metadata if present
        if (msg.Metadata.TryGetValue("tool_calls", out var tcObj) && tcObj is List<ToolCall> toolCalls)
        {
            foreach (var tc in toolCalls)
            {
                assistant.ToolCalls.Add(
                    ChatToolCall.CreateFunctionToolCall(tc.Id, tc.Name, BinaryData.FromString(tc.Arguments)));
            }
        }

        return assistant;
    }

    /// <summary>
    /// Convert Prompty tools to OpenAI ChatTool definitions.
    /// </summary>
    public static List<ChatTool>? ToolsToWire(Core.Prompty agent)
    {
        if (agent.Tools is null || agent.Tools.Count == 0)
            return null;

        var tools = new List<ChatTool>();

        foreach (var tool in agent.Tools)
        {
            if (tool is Core.FunctionTool ft)
            {
                var parameters = SchemaHelpers.PropertiesToJsonSchema(ft.Parameters, ft.Strict == true);
                var chatTool = ChatTool.CreateFunctionTool(
                    ft.Name ?? "",
                    ft.Description,
                    BinaryData.FromString(JsonSerializer.Serialize(parameters)),
                    ft.Strict == true);
                tools.Add(chatTool);
            }
        }

        return tools.Count > 0 ? tools : null;
    }

    /// <summary>
    /// Convert outputSchema to OpenAI response_format.
    /// </summary>
    public static ChatResponseFormat? OutputSchemaToWire(Core.Prompty agent)
    {
        if (agent.Outputs is null || agent.Outputs.Count == 0)
            return null;

        var schema = SchemaHelpers.PropertiesToJsonSchema(agent.Outputs, strict: true);

        return ChatResponseFormat.CreateJsonSchemaFormat(
            "structured_output",
            BinaryData.FromString(JsonSerializer.Serialize(schema)),
            jsonSchemaIsStrict: true);
    }

    /// <summary>
    /// Build ChatCompletionOptions from agent's ModelOptions.
    /// </summary>
    public static ChatCompletionOptions BuildOptions(Core.Prompty agent)
    {
        var options = new ChatCompletionOptions();
        var opts = agent.Model?.Options;

        if (opts is null)
            return options;

        if (opts.Temperature is not null)
            options.Temperature = (float)opts.Temperature;
        if (opts.MaxOutputTokens is not null)
            options.MaxOutputTokenCount = (int)opts.MaxOutputTokens;
        if (opts.TopP is not null)
            options.TopP = (float)opts.TopP;
        if (opts.FrequencyPenalty is not null)
            options.FrequencyPenalty = (float)opts.FrequencyPenalty;
        if (opts.PresencePenalty is not null)
            options.PresencePenalty = (float)opts.PresencePenalty;
        if (opts.Seed is not null)
            options.Seed = (long)opts.Seed;
        if (opts.StopSequences is not null)
        {
            foreach (var s in opts.StopSequences)
                options.StopSequences.Add(s);
        }

        // Tools
        var tools = ToolsToWire(agent);
        if (tools is not null)
        {
            foreach (var tool in tools)
                options.Tools.Add(tool);
        }

        // Structured output
        var responseFormat = OutputSchemaToWire(agent);
        if (responseFormat is not null)
            options.ResponseFormat = responseFormat;

        return options;
    }

}
