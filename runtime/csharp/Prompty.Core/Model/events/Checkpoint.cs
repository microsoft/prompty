// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// A persisted handoff point for a harness session.
/// </summary>
public partial class Checkpoint
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="Checkpoint"/>.
    /// </summary>
#pragma warning disable CS8618
    public Checkpoint()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Stable checkpoint identifier
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// Stable session identifier
    /// </summary>
    public string? SessionId { get; set; }

    /// <summary>
    /// Associated turn identifier, when the checkpoint was created inside a turn
    /// </summary>
    public string? TurnId { get; set; }

    /// <summary>
    /// Monotonic checkpoint number within the session
    /// </summary>
    public int? CheckpointNumber { get; set; }

    /// <summary>
    /// Short checkpoint title
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Short human-readable overview
    /// </summary>
    public string? Overview { get; set; }

    /// <summary>
    /// Portable checkpoint state needed to resume or hand off the session
    /// </summary>
    public IDictionary<string, object>? State { get; set; }

    /// <summary>
    /// Optional host-authored summary or handoff note
    /// </summary>
    public string? Summary { get; set; }

    /// <summary>
    /// Host-defined checkpoint metadata
    /// </summary>
    public IDictionary<string, object>? Metadata { get; set; }

    /// <summary>
    /// ISO 8601 UTC timestamp when the checkpoint was created
    /// </summary>
    public string? CreatedAt { get; set; }

    /// <summary>
    /// Redaction state for sensitive checkpoint fields
    /// </summary>
    public RedactionMetadata? Redaction { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a Checkpoint instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Checkpoint instance.</returns>
    public static Checkpoint Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new Checkpoint();


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

        if (data.TryGetValue("checkpointNumber", out var checkpointNumberValue) && checkpointNumberValue is not null)
        {
            instance.CheckpointNumber = Convert.ToInt32(checkpointNumberValue);
        }

        if (data.TryGetValue("title", out var titleValue) && titleValue is not null)
        {
            instance.Title = titleValue?.ToString()!;
        }

        if (data.TryGetValue("overview", out var overviewValue) && overviewValue is not null)
        {
            instance.Overview = overviewValue?.ToString()!;
        }

        if (data.TryGetValue("state", out var stateValue) && stateValue is not null)
        {
            instance.State = stateValue.GetDictionary()!;
        }

        if (data.TryGetValue("summary", out var summaryValue) && summaryValue is not null)
        {
            instance.Summary = summaryValue?.ToString()!;
        }

        if (data.TryGetValue("metadata", out var metadataValue) && metadataValue is not null)
        {
            instance.Metadata = metadataValue.GetDictionary()!;
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
    /// Save the Checkpoint instance to a dictionary.
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


        if (obj.CheckpointNumber is not null)
        {
            result["checkpointNumber"] = obj.CheckpointNumber;
        }


        result["title"] = obj.Title;


        if (obj.Overview is not null)
        {
            result["overview"] = obj.Overview;
        }


        if (obj.State is not null)
        {
            result["state"] = obj.State;
        }


        if (obj.Summary is not null)
        {
            result["summary"] = obj.Summary;
        }


        if (obj.Metadata is not null)
        {
            result["metadata"] = obj.Metadata;
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
    /// Convert the Checkpoint instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Checkpoint instance to a JSON string.
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
    /// Load a Checkpoint instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Checkpoint instance.</returns>
    public static Checkpoint FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Checkpoint instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Checkpoint instance.</returns>
    public static Checkpoint FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
