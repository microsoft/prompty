// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "tool_execution_start" events — the host is about to execute a concrete tool request.
///
/// This is distinct from "tool_call_start", which records the model requesting a tool.
///
/// Tool execution events capture the harness-side action after policy and permission checks.
/// </summary>
public partial class ToolExecutionStartPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ToolExecutionStartPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public ToolExecutionStartPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Stable host execution request identifier
    /// </summary>
    public string? RequestId { get; set; }

    /// <summary>
    /// Associated model tool call identifier, when available
    /// </summary>
    public string? ToolCallId { get; set; }

    /// <summary>
    /// Name of the host tool being executed
    /// </summary>
    public string ToolName { get; set; } = string.Empty;

    /// <summary>
    /// Tool arguments after host-side sanitization
    /// </summary>
    public IDictionary<string, object>? Arguments { get; set; }

    /// <summary>
    /// Working directory or execution scope for the tool
    /// </summary>
    public string? WorkingDirectory { get; set; }

    /// <summary>
    /// Redaction state for sensitive argument fields
    /// </summary>
    public RedactionMetadata? Redaction { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a ToolExecutionStartPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolExecutionStartPayload instance.</returns>
    public static ToolExecutionStartPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ToolExecutionStartPayload();


        if (data.TryGetValue("requestId", out var requestIdValue) && requestIdValue is not null)
        {
            instance.RequestId = requestIdValue?.ToString()!;
        }

        if (data.TryGetValue("toolCallId", out var toolCallIdValue) && toolCallIdValue is not null)
        {
            instance.ToolCallId = toolCallIdValue?.ToString()!;
        }

        if (data.TryGetValue("toolName", out var toolNameValue) && toolNameValue is not null)
        {
            instance.ToolName = toolNameValue?.ToString()!;
        }

        if (data.TryGetValue("arguments", out var argumentsValue) && argumentsValue is not null)
        {
            instance.Arguments = argumentsValue.GetDictionary()!;
        }

        if (data.TryGetValue("workingDirectory", out var workingDirectoryValue) && workingDirectoryValue is not null)
        {
            instance.WorkingDirectory = workingDirectoryValue?.ToString()!;
        }

        if (data.TryGetValue("redaction", out var redactionValue) && redactionValue is not null)
        {
            instance.Redaction = RedactionMetadata.Load(redactionValue.GetDictionary(RedactionMetadata.ShorthandProperty), context);
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
    /// Save the ToolExecutionStartPayload instance to a dictionary.
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


        if (obj.RequestId is not null)
        {
            result["requestId"] = obj.RequestId;
        }


        if (obj.ToolCallId is not null)
        {
            result["toolCallId"] = obj.ToolCallId;
        }


        result["toolName"] = obj.ToolName;


        if (obj.Arguments is not null)
        {
            result["arguments"] = obj.Arguments;
        }


        if (obj.WorkingDirectory is not null)
        {
            result["workingDirectory"] = obj.WorkingDirectory;
        }


        if (obj.Redaction is not null)
        {
            result["redaction"] = obj.Redaction?.Save(context);
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ToolExecutionStartPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ToolExecutionStartPayload instance to a JSON string.
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
    /// Load a ToolExecutionStartPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolExecutionStartPayload instance.</returns>
    public static ToolExecutionStartPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ToolExecutionStartPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolExecutionStartPayload instance.</returns>
    public static ToolExecutionStartPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
