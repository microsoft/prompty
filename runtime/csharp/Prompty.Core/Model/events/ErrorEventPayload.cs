// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "error" events — an error occurred during the loop.
/// </summary>
public partial class ErrorEventPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ErrorEventPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public ErrorEventPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Human-readable error description
    /// </summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// Stable machine-readable error category
    /// </summary>
    public string? ErrorKind { get; set; }

    /// <summary>
    /// Operation or phase where the error occurred
    /// </summary>
    public string? Phase { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a ErrorEventPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ErrorEventPayload instance.</returns>
    public static ErrorEventPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ErrorEventPayload();


        if (data.TryGetValue("message", out var messageValue) && messageValue is not null)
        {
            instance.Message = messageValue?.ToString()!;
        }

        if (data.TryGetValue("errorKind", out var errorKindValue) && errorKindValue is not null)
        {
            instance.ErrorKind = errorKindValue?.ToString()!;
        }

        if (data.TryGetValue("phase", out var phaseValue) && phaseValue is not null)
        {
            instance.Phase = phaseValue?.ToString()!;
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
    /// Save the ErrorEventPayload instance to a dictionary.
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


        result["message"] = obj.Message;


        if (obj.ErrorKind is not null)
        {
            result["errorKind"] = obj.ErrorKind;
        }


        if (obj.Phase is not null)
        {
            result["phase"] = obj.Phase;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ErrorEventPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ErrorEventPayload instance to a JSON string.
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
    /// Load a ErrorEventPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ErrorEventPayload instance.</returns>
    public static ErrorEventPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ErrorEventPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ErrorEventPayload instance.</returns>
    public static ErrorEventPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
