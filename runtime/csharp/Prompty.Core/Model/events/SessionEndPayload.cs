// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "session_end" events.
/// </summary>
public partial class SessionEndPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="SessionEndPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public SessionEndPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Stable session identifier
    /// </summary>
    public string? SessionId { get; set; }

    /// <summary>
    /// Final session status
    /// </summary>
    public SessionEndStatus? Status { get; set; }

    /// <summary>
    /// Host-specific reason the session ended
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>
    /// Total elapsed session duration in milliseconds
    /// </summary>
    public double? DurationMs { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a SessionEndPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded SessionEndPayload instance.</returns>
    public static SessionEndPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new SessionEndPayload();


        if (data.TryGetValue("sessionId", out var sessionIdValue) && sessionIdValue is not null)
        {
            instance.SessionId = sessionIdValue?.ToString()!;
        }

        if (data.TryGetValue("status", out var statusValue) && statusValue is not null)
        {
            instance.Status = Enum.Parse<SessionEndStatus>(statusValue?.ToString()!, true);
        }

        if (data.TryGetValue("reason", out var reasonValue) && reasonValue is not null)
        {
            instance.Reason = reasonValue?.ToString()!;
        }

        if (data.TryGetValue("durationMs", out var durationMsValue) && durationMsValue is not null)
        {
            instance.DurationMs = Convert.ToDouble(durationMsValue);
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
    /// Save the SessionEndPayload instance to a dictionary.
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


        if (obj.SessionId is not null)
        {
            result["sessionId"] = obj.SessionId;
        }


        if (obj.Status is not null)
        {
            result["status"] = obj.Status.Value.ToString().ToLowerInvariant();
        }


        if (obj.Reason is not null)
        {
            result["reason"] = obj.Reason;
        }


        if (obj.DurationMs is not null)
        {
            result["durationMs"] = obj.DurationMs;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the SessionEndPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the SessionEndPayload instance to a JSON string.
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
    /// Load a SessionEndPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded SessionEndPayload instance.</returns>
    public static SessionEndPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a SessionEndPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded SessionEndPayload instance.</returns>
    public static SessionEndPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
