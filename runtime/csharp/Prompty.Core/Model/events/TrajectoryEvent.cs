// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// A compact, replay-oriented record of one harness-side action or observation.
/// </summary>
public partial class TrajectoryEvent
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="TrajectoryEvent"/>.
    /// </summary>
#pragma warning disable CS8618
    public TrajectoryEvent()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Stable trajectory event identifier
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// Stable session identifier
    /// </summary>
    public string? SessionId { get; set; }

    /// <summary>
    /// Associated turn identifier, when available
    /// </summary>
    public string? TurnId { get; set; }

    /// <summary>
    /// Associated tool call identifier, when available
    /// </summary>
    public string? ToolCallId { get; set; }

    /// <summary>
    /// Zero-based turn index in the session
    /// </summary>
    public int? TurnIndex { get; set; }

    /// <summary>
    /// Host-defined trajectory event category
    /// </summary>
    public string EventType { get; set; } = string.Empty;

    /// <summary>
    /// Sanitized event data
    /// </summary>
    public IDictionary<string, object>? Data { get; set; }

    /// <summary>
    /// ISO 8601 UTC timestamp when the trajectory event was recorded
    /// </summary>
    public string? CreatedAt { get; set; }

    /// <summary>
    /// Redaction state for sensitive trajectory fields
    /// </summary>
    public RedactionMetadata? Redaction { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a TrajectoryEvent instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TrajectoryEvent instance.</returns>
    public static TrajectoryEvent Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new TrajectoryEvent();


        if (data.TryGetValue("id", out var idValue) && idValue is not null)
        {
            instance.Id = idValue?.ToString()!;
        }

        if (data.TryGetValue("sessionId", out var sessionIdValue) && sessionIdValue is not null)
        {
            instance.SessionId = sessionIdValue?.ToString()!;
        }

        if (data.TryGetValue("turnId", out var turnIdValue) && turnIdValue is not null)
        {
            instance.TurnId = turnIdValue?.ToString()!;
        }

        if (data.TryGetValue("toolCallId", out var toolCallIdValue) && toolCallIdValue is not null)
        {
            instance.ToolCallId = toolCallIdValue?.ToString()!;
        }

        if (data.TryGetValue("turnIndex", out var turnIndexValue) && turnIndexValue is not null)
        {
            instance.TurnIndex = Convert.ToInt32(turnIndexValue);
        }

        if (data.TryGetValue("eventType", out var eventTypeValue) && eventTypeValue is not null)
        {
            instance.EventType = eventTypeValue?.ToString()!;
        }

        if (data.TryGetValue("data", out var dataValue) && dataValue is not null)
        {
            instance.Data = dataValue.GetDictionary()!;
        }

        if (data.TryGetValue("createdAt", out var createdAtValue) && createdAtValue is not null)
        {
            instance.CreatedAt = createdAtValue?.ToString()!;
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
    /// Save the TrajectoryEvent instance to a dictionary.
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


        if (obj.SessionId is not null)
        {
            result["sessionId"] = obj.SessionId;
        }


        if (obj.TurnId is not null)
        {
            result["turnId"] = obj.TurnId;
        }


        if (obj.ToolCallId is not null)
        {
            result["toolCallId"] = obj.ToolCallId;
        }


        if (obj.TurnIndex is not null)
        {
            result["turnIndex"] = obj.TurnIndex;
        }


        result["eventType"] = obj.EventType;


        if (obj.Data is not null)
        {
            result["data"] = obj.Data;
        }


        if (obj.CreatedAt is not null)
        {
            result["createdAt"] = obj.CreatedAt;
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
    /// Convert the TrajectoryEvent instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the TrajectoryEvent instance to a JSON string.
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
    /// Load a TrajectoryEvent instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TrajectoryEvent instance.</returns>
    public static TrajectoryEvent FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a TrajectoryEvent instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TrajectoryEvent instance.</returns>
    public static TrajectoryEvent FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
