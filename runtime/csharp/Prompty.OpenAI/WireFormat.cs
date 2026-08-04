// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.ClientModel.Primitives;
using System.Text;
using System.Text.Json;
using OpenAI.Chat;
using OpenAI.Responses;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Shared helpers for converting Prompty types to OpenAI SDK wire format.
/// Used by both OpenAI and Foundry providers.
/// </summary>
public static class WireFormat
{
    // -----------------------------------------------------------------------
    // Chat Completions wire format
    // -----------------------------------------------------------------------

    /// <summary>
    /// Convert a Prompty Message to an OpenAI ChatMessage.
    /// </summary>
    public static ChatMessage MessageToWire(Message msg)
    {
        var content = msg.ToTextContent();

        return msg.Role switch
        {
            Role.System => new SystemChatMessage(msg.Text),
            Role.Developer => new DeveloperChatMessage(msg.Text),
            Role.User => content switch
            {
                string text => new UserChatMessage(text),
                _ => new UserChatMessage(BuildContentParts(msg.Parts)),
            },
            Role.Assistant => BuildAssistantMessage(msg),
            Role.Tool => new ToolChatMessage(
                msg.Metadata?.TryGetValue("tool_call_id", out var id) == true ? id?.ToString() ?? "" : "",
                msg.Text),
            _ => new UserChatMessage(msg.Text),
        };
    }

    private static IEnumerable<ChatMessageContentPart> BuildContentParts(IList<ContentPart> parts)
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
                case AudioPart audio:
                    yield return BuildAudioContentPart(audio);
                    break;
                case FilePart file:
                    var filePart = ChatMessageContentPart.CreateFilePart(file.Source);
                    filePart.Patch.Set(
                        "$.file"u8,
                        BinaryData.FromObjectAsJson(new Dictionary<string, object?> { ["url"] = file.Source }).ToMemory().Span);
                    yield return filePart;
                    break;
            }
        }
    }

    private static ChatMessageContentPart BuildAudioContentPart(AudioPart audio)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(audio.Source);
        }
        catch (FormatException)
        {
            bytes = Encoding.UTF8.GetBytes(audio.Source);
        }

        var format = AudioFormat(audio.MediaType);
        var part = ChatMessageContentPart.CreateInputAudioPart(
            BinaryData.FromBytes(bytes),
            format == "mp3" ? ChatInputAudioFormat.Mp3 : ChatInputAudioFormat.Wav);
        part.Patch.Set("$.input_audio.data"u8, BinaryData.FromObjectAsJson(audio.Source).ToMemory().Span);
        part.Patch.Set("$.input_audio.format"u8, BinaryData.FromObjectAsJson(format).ToMemory().Span);
        return part;
    }

    private static string AudioFormat(string? mediaType)
    {
        return mediaType?.ToLowerInvariant() switch
        {
            "audio/wav" or "audio/x-wav" => "wav",
            "audio/mpeg" or "audio/mp3" => "mp3",
            "audio/mp4" => "mp4",
            "audio/ogg" => "ogg",
            "audio/flac" => "flac",
            "audio/webm" => "webm",
            "audio/pcm" => "pcm",
            { } value when value.StartsWith("audio/", StringComparison.Ordinal) => value["audio/".Length..],
            _ => "wav"
        };
    }

    private static AssistantChatMessage BuildAssistantMessage(Message msg)
    {
        var assistant = new AssistantChatMessage(msg.Text);

        // Attach tool calls from metadata if present
        if (msg.Metadata is not null && msg.Metadata.TryGetValue("tool_calls", out var tcObj) && tcObj is List<ToolCall> toolCalls)
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
                var boundNames = BoundParameterNames(ft);
                var parameters = SchemaHelpers.PropertiesToJsonSchema(
                    ft.Parameters,
                    ft.Strict == true,
                    boundNames,
                    supportsOneOf: false);
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
    /// Convert outputs to OpenAI response_format.
    /// </summary>
    public static ChatResponseFormat? OutputSchemaToWire(Core.Prompty agent)
    {
        if (agent.Outputs is null || agent.Outputs.Count == 0)
            return null;

        var schema = SchemaHelpers.PropertiesToJsonSchema(agent.Outputs, strict: true, supportsOneOf: false);

        return ChatResponseFormat.CreateJsonSchemaFormat(
            "structured_output",
            BinaryData.FromString(JsonSerializer.Serialize(schema)),
            jsonSchemaIsStrict: true);
    }

    /// <summary>
    /// Build ChatCompletionOptions from agent's ModelOptions.
    /// Note: ModelOptions.ToWire("openai") is available for raw HTTP providers,
    /// but this method uses the strongly-typed OpenAI SDK ChatCompletionOptions object.
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
        if (opts.AllowMultipleToolCalls is not null)
            options.AllowParallelToolCalls = opts.AllowMultipleToolCalls;
        if (opts.StopSequences is not null)
        {
            foreach (var s in opts.StopSequences)
                options.StopSequences.Add(s);
        }
        if (opts.AdditionalProperties is not null)
        {
            foreach (var (name, value) in opts.AdditionalProperties)
            {
                if (CanonicalOptionIsSet(name, agent, opts))
                    continue;
                if (string.IsNullOrWhiteSpace(name) ||
                    name.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '_'))
                    throw new ArgumentException(
                        $"OpenAI additional option name '{name}' cannot be represented safely by the SDK.",
                        nameof(agent));

                var path = Encoding.UTF8.GetBytes($"$.{name}");
                var json = BinaryData.FromObjectAsJson(value).ToMemory().Span;
                options.Patch.Set(path, json);
            }
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

    private static bool CanonicalOptionIsSet(string name, Core.Prompty agent, ModelOptions options)
    {
        return name switch
        {
            "model" or "messages" or "stream" => true,
            "temperature" => options.Temperature is not null,
            "max_completion_tokens" => options.MaxOutputTokens is not null,
            "top_p" => options.TopP is not null,
            "frequency_penalty" => options.FrequencyPenalty is not null,
            "presence_penalty" => options.PresencePenalty is not null,
            "seed" => options.Seed is not null,
            "stop" => options.StopSequences is not null,
            "parallel_tool_calls" => options.AllowMultipleToolCalls is not null,
            "tools" => agent.Tools is { Count: > 0 },
            "response_format" => agent.Outputs is { Count: > 0 },
            _ => false
        };
    }

    // -----------------------------------------------------------------------
    // Responses API wire format
    // -----------------------------------------------------------------------

    /// <summary>
    /// Build CreateResponseOptions for the Responses API.
    /// Converts messages to input items, extracts instructions from system/developer messages.
    /// </summary>
    public static CreateResponseOptions BuildResponsesOptions(string model, Core.Prompty agent, List<Message> messages)
    {
        var options = new CreateResponseOptions
        {
            Model = model,
        };

        // Extract system/developer messages as instructions
        var instructionParts = new List<string>();
        foreach (var msg in messages)
        {
            if (msg.Role is Role.System or Role.Developer)
            {
                var text = msg.Text;
                if (!string.IsNullOrEmpty(text))
                    instructionParts.Add(text);
            }
        }
        if (instructionParts.Count > 0)
            options.Instructions = string.Join("\n\n", instructionParts);

        // Convert non-system/non-developer messages to input items
        foreach (var msg in messages)
        {
            if (msg.Role is Role.System or Role.Developer)
                continue;

            var item = MessageToResponsesInput(msg);
            if (item is not null)
                options.InputItems.Add(item);
        }

        // Model options
        var opts = agent.Model?.Options;
        if (opts is not null)
        {
            if (opts.Temperature is not null)
                options.Temperature = (float)opts.Temperature;
            if (opts.MaxOutputTokens is not null)
                options.MaxOutputTokenCount = (int)opts.MaxOutputTokens;
            if (opts.TopP is not null)
                options.TopP = (float)opts.TopP;
        }

        // Tools — flat Responses format
        var responsesTools = ToolsToResponsesWire(agent);
        if (responsesTools is not null)
        {
            foreach (var tool in responsesTools)
                options.Tools.Add(tool);
        }

        // Structured output → text.format (json_schema)
        if (agent.Outputs is not null && agent.Outputs.Count > 0)
        {
            var schema = SchemaHelpers.PropertiesToJsonSchema(agent.Outputs, strict: true, supportsOneOf: false);
            options.TextOptions ??= new ResponseTextOptions();
            options.TextOptions.TextFormat = ResponseTextFormat.CreateJsonSchemaFormat(
                "structured_output",
                BinaryData.FromString(JsonSerializer.Serialize(schema)),
                jsonSchemaIsStrict: true);
        }

        return options;
    }

    /// <summary>
    /// Convert a Prompty Message to a Responses API input item.
    /// </summary>
    public static ResponseItem? MessageToResponsesInput(Message msg)
    {
        // Pass through function call items stored in metadata
        if (msg.Metadata is not null && msg.Metadata.TryGetValue("responses_function_call", out var fcObj) && fcObj is ResponseItem fcItem)
            return fcItem;

        // Tool result → function_call_output
        if (msg.Role == Role.Tool && msg.Metadata is not null && msg.Metadata.TryGetValue("tool_call_id", out var tcId))
        {
            return ResponseItem.CreateFunctionCallOutputItem(
                tcId?.ToString() ?? "",
                msg.Text);
        }

        // User messages
        if (msg.Role is Role.User)
            return ResponseItem.CreateUserMessageItem(msg.Text);

        // Assistant messages
        if (msg.Role is Role.Assistant)
            return ResponseItem.CreateAssistantMessageItem(msg.Text);

        // Default: treat as user
        return ResponseItem.CreateUserMessageItem(msg.Text);
    }

    /// <summary>
    /// Convert Prompty tools to Responses API tool definitions (flat format).
    /// </summary>
    public static List<ResponseTool>? ToolsToResponsesWire(Core.Prompty agent)
    {
        if (agent.Tools is null || agent.Tools.Count == 0)
            return null;

        var tools = new List<ResponseTool>();

        foreach (var tool in agent.Tools)
        {
            if (tool is Core.FunctionTool ft)
            {
                var boundNames = BoundParameterNames(ft);
                var parameters = SchemaHelpers.PropertiesToJsonSchema(
                    ft.Parameters,
                    ft.Strict == true,
                    boundNames,
                    supportsOneOf: false);
                var responseTool = ResponseTool.CreateFunctionTool(
                    ft.Name ?? "",
                    BinaryData.FromString(JsonSerializer.Serialize(parameters)),
                    ft.Strict == true,
                    ft.Description);
                tools.Add(responseTool);
            }
        }

        return tools.Count > 0 ? tools : null;
    }

    private static ISet<string>? BoundParameterNames(Core.Tool tool)
    {
        if (tool.Bindings is null || tool.Bindings.Count == 0)
            return null;

        return tool.Bindings
            .Where(binding => !string.IsNullOrEmpty(binding.Name))
            .Select(binding => binding.Name!)
            .ToHashSet(StringComparer.Ordinal);
    }
}
