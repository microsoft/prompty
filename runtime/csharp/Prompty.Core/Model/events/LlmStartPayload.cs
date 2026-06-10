// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "llm_start" events — an LLM request is about to be sent.
/// </summary>
public partial class LlmStartPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="LlmStartPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public LlmStartPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Provider identifier used for the request
    /// </summary>
    public string? Provider { get; set; }

    /// <summary>
    /// Model or deployment identifier used for the request
    /// </summary>
    public string? ModelId { get; set; }

    /// <summary>
    /// Number of messages sent to the provider
    /// </summary>
    public int? MessageCount { get; set; }

    /// <summary>
    /// Retry attempt number, zero for the initial attempt
    /// </summary>
    public int? Attempt { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a LlmStartPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmStartPayload instance.</returns>
    public static LlmStartPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new LlmStartPayload();


        if (data.TryGetValue("provider", out var providerValue) && providerValue is not null)
        {
            instance.Provider = providerValue?.ToString()!;
        }

        if (data.TryGetValue("modelId", out var modelIdValue) && modelIdValue is not null)
        {
            instance.ModelId = modelIdValue?.ToString()!;
        }

        if (data.TryGetValue("messageCount", out var messageCountValue) && messageCountValue is not null)
        {
            instance.MessageCount = Convert.ToInt32(messageCountValue);
        }

        if (data.TryGetValue("attempt", out var attemptValue) && attemptValue is not null)
        {
            instance.Attempt = Convert.ToInt32(attemptValue);
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
    /// Save the LlmStartPayload instance to a dictionary.
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


        if (obj.Provider is not null)
        {
            result["provider"] = obj.Provider;
        }


        if (obj.ModelId is not null)
        {
            result["modelId"] = obj.ModelId;
        }


        if (obj.MessageCount is not null)
        {
            result["messageCount"] = obj.MessageCount;
        }


        if (obj.Attempt is not null)
        {
            result["attempt"] = obj.Attempt;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the LlmStartPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the LlmStartPayload instance to a JSON string.
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
    /// Load a LlmStartPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmStartPayload instance.</returns>
    public static LlmStartPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a LlmStartPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmStartPayload instance.</returns>
    public static LlmStartPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
