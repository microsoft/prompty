// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "tool_call_complete" events — a tool dispatch finished.
/// </summary>
public partial class ToolCallCompletePayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ToolCallCompletePayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public ToolCallCompletePayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The unique identifier of the tool call
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// The name of the tool that completed
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Whether the tool dispatch succeeded semantically
    /// </summary>
    public bool Success { get; set; } = false;

    /// <summary>
    /// Normalized tool result
    /// </summary>
    public ToolResult? Result { get; set; }

    /// <summary>
    /// Tool execution duration in milliseconds
    /// </summary>
    public double? DurationMs { get; set; }

    /// <summary>
    /// Machine-readable error category when success is false
    /// </summary>
    public string? ErrorKind { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a ToolCallCompletePayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolCallCompletePayload instance.</returns>
    public static ToolCallCompletePayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ToolCallCompletePayload();


        if (data.TryGetValue("id", out var idValue) && idValue is not null)
        {
            instance.Id = idValue?.ToString()!;
        }

        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("success", out var successValue) && successValue is not null)
        {
            instance.Success = Convert.ToBoolean(successValue);
        }

        if (data.TryGetValue("result", out var resultValue) && resultValue is not null)
        {
            instance.Result = ToolResult.Load(resultValue.GetDictionary(ToolResult.ShorthandProperty), context);
        }

        if (data.TryGetValue("durationMs", out var durationMsValue) && durationMsValue is not null)
        {
            instance.DurationMs = Convert.ToDouble(durationMsValue);
        }

        if (data.TryGetValue("errorKind", out var errorKindValue) && errorKindValue is not null)
        {
            instance.ErrorKind = errorKindValue?.ToString()!;
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
    /// Save the ToolCallCompletePayload instance to a dictionary.
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


        if (obj.Id is not null)
        {
            result["id"] = obj.Id;
        }


        result["name"] = obj.Name;


        result["success"] = obj.Success;


        if (obj.Result is not null)
        {
            result["result"] = obj.Result?.Save(context);
        }


        if (obj.DurationMs is not null)
        {
            result["durationMs"] = obj.DurationMs;
        }


        if (obj.ErrorKind is not null)
        {
            result["errorKind"] = obj.ErrorKind;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ToolCallCompletePayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ToolCallCompletePayload instance to a JSON string.
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
    /// Load a ToolCallCompletePayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolCallCompletePayload instance.</returns>
    public static ToolCallCompletePayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ToolCallCompletePayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolCallCompletePayload instance.</returns>
    public static ToolCallCompletePayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
