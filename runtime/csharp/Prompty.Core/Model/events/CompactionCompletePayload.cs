// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "compaction_complete" events — context compaction finished.
/// </summary>
public partial class CompactionCompletePayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="CompactionCompletePayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public CompactionCompletePayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Number of messages removed during compaction
    /// </summary>
    public int Removed { get; set; }

    /// <summary>
    /// Number of messages remaining after compaction
    /// </summary>
    public int Remaining { get; set; }

    /// <summary>
    /// Length of the generated summary, when a summarization strategy is used
    /// </summary>
    public int? SummaryLength { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a CompactionCompletePayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CompactionCompletePayload instance.</returns>
    public static CompactionCompletePayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new CompactionCompletePayload();


        if (data.TryGetValue("removed", out var removedValue) && removedValue is not null)
        {
            instance.Removed = Convert.ToInt32(removedValue);
        }

        if (data.TryGetValue("remaining", out var remainingValue) && remainingValue is not null)
        {
            instance.Remaining = Convert.ToInt32(remainingValue);
        }

        if (data.TryGetValue("summaryLength", out var summaryLengthValue) && summaryLengthValue is not null)
        {
            instance.SummaryLength = Convert.ToInt32(summaryLengthValue);
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
    /// Save the CompactionCompletePayload instance to a dictionary.
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


        result["removed"] = obj.Removed;


        result["remaining"] = obj.Remaining;


        if (obj.SummaryLength is not null)
        {
            result["summaryLength"] = obj.SummaryLength;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the CompactionCompletePayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the CompactionCompletePayload instance to a JSON string.
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
    /// Load a CompactionCompletePayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CompactionCompletePayload instance.</returns>
    public static CompactionCompletePayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a CompactionCompletePayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CompactionCompletePayload instance.</returns>
    public static CompactionCompletePayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
