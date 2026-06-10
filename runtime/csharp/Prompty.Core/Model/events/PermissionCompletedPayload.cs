// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for permission completion events — an approval decision was made.
/// </summary>
public partial class PermissionCompletedPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="PermissionCompletedPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public PermissionCompletedPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Stable permission request identifier
    /// </summary>
    public string? RequestId { get; set; }

    /// <summary>
    /// Associated tool call identifier, when the permission gated a tool call
    /// </summary>
    public string? ToolCallId { get; set; }

    /// <summary>
    /// Permission/action name that was decided
    /// </summary>
    public string Permission { get; set; } = string.Empty;

    /// <summary>
    /// Whether the requested permission was approved
    /// </summary>
    public bool Approved { get; set; } = false;

    /// <summary>
    /// Decision reason, if available
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>
    /// Host-specific decision result, such as a durable approval token or denial details
    /// </summary>
    public IDictionary<string, object>? Result { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a PermissionCompletedPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PermissionCompletedPayload instance.</returns>
    public static PermissionCompletedPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new PermissionCompletedPayload();


        if (data.TryGetValue("requestId", out var requestIdValue) && requestIdValue is not null)
        {
            instance.RequestId = requestIdValue?.ToString()!;
        }

        if (data.TryGetValue("toolCallId", out var toolCallIdValue) && toolCallIdValue is not null)
        {
            instance.ToolCallId = toolCallIdValue?.ToString()!;
        }

        if (data.TryGetValue("permission", out var permissionValue) && permissionValue is not null)
        {
            instance.Permission = permissionValue?.ToString()!;
        }

        if (data.TryGetValue("approved", out var approvedValue) && approvedValue is not null)
        {
            instance.Approved = Convert.ToBoolean(approvedValue);
        }

        if (data.TryGetValue("reason", out var reasonValue) && reasonValue is not null)
        {
            instance.Reason = reasonValue?.ToString()!;
        }

        if (data.TryGetValue("result", out var resultValue) && resultValue is not null)
        {
            instance.Result = resultValue.GetDictionary()!;
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
    /// Save the PermissionCompletedPayload instance to a dictionary.
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


        result["permission"] = obj.Permission;


        result["approved"] = obj.Approved;


        if (obj.Reason is not null)
        {
            result["reason"] = obj.Reason;
        }


        if (obj.Result is not null)
        {
            result["result"] = obj.Result;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the PermissionCompletedPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the PermissionCompletedPayload instance to a JSON string.
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
    /// Load a PermissionCompletedPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PermissionCompletedPayload instance.</returns>
    public static PermissionCompletedPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a PermissionCompletedPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PermissionCompletedPayload instance.</returns>
    public static PermissionCompletedPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
