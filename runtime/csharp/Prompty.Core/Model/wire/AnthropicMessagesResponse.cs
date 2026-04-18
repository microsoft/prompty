// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The response body from the Anthropic Messages API.
/// </summary>
public partial class AnthropicMessagesResponse
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="AnthropicMessagesResponse"/>.
    /// </summary>
#pragma warning disable CS8618
    public AnthropicMessagesResponse()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Unique response identifier
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Object type (always 'message')
    /// </summary>
    public string Type { get; set; } = "message";

    /// <summary>
    /// The role of the response (always 'assistant')
    /// </summary>
    public string Role { get; set; } = "assistant";

    /// <summary>
    /// Array of content blocks in the response (AnthropicTextBlock | AnthropicToolUseBlock)
    /// </summary>
    public IList<object> Content { get; set; } = [];

    /// <summary>
    /// The model that generated the response
    /// </summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>
    /// The reason generation stopped ('end_turn', 'max_tokens', 'stop_sequence', 'tool_use')
    /// </summary>
    public string StopReason { get; set; } = string.Empty;

    /// <summary>
    /// Token usage statistics
    /// </summary>
    public AnthropicUsage Usage { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a AnthropicMessagesResponse instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesResponse instance.</returns>
    public static AnthropicMessagesResponse Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new AnthropicMessagesResponse();


        if (data.TryGetValue("id", out var idValue) && idValue is not null)
        {
            instance.Id = idValue?.ToString()!;
        }

        if (data.TryGetValue("type", out var typeValue) && typeValue is not null)
        {
            instance.Type = typeValue?.ToString()!;
        }

        if (data.TryGetValue("role", out var roleValue) && roleValue is not null)
        {
            instance.Role = roleValue?.ToString()!;
        }

        if (data.TryGetValue("content", out var contentValue) && contentValue is not null)
        {
            instance.Content = (contentValue as IEnumerable<object>)?.ToList() ?? [];
        }

        if (data.TryGetValue("model", out var modelValue) && modelValue is not null)
        {
            instance.Model = modelValue?.ToString()!;
        }

        if (data.TryGetValue("stop_reason", out var stop_reasonValue) && stop_reasonValue is not null)
        {
            instance.StopReason = stop_reasonValue?.ToString()!;
        }

        if (data.TryGetValue("usage", out var usageValue) && usageValue is not null)
        {
            instance.Usage = AnthropicUsage.Load(usageValue.GetDictionary(AnthropicUsage.ShorthandProperty), context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the AnthropicMessagesResponse instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public Dictionary<string, object?> Save(SaveContext? context = null)
    {
        var obj = this;
        if (context is not null)
        {
            obj = context.ProcessObject(obj);
        }


        var result = new Dictionary<string, object?>();


        result["id"] = obj.Id;


        result["type"] = obj.Type;


        result["role"] = obj.Role;


        result["content"] = obj.Content;


        result["model"] = obj.Model;


        result["stop_reason"] = obj.StopReason;


        result["usage"] = obj.Usage?.Save(context);


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the AnthropicMessagesResponse instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the AnthropicMessagesResponse instance to a JSON string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation of this instance.</returns>
    public string ToJson(SaveContext? context = null, bool indent = true)
    {
        context ??= new SaveContext();
        return context.ToJson(Save(context), indent);
    }

    /// <summary>
    /// Load a AnthropicMessagesResponse instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesResponse instance.</returns>
    public static AnthropicMessagesResponse FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a AnthropicMessagesResponse instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesResponse instance.</returns>
    public static AnthropicMessagesResponse FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
