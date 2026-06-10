// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "llm_complete" events — an LLM request completed.
/// </summary>
public partial class LlmCompletePayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="LlmCompletePayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public LlmCompletePayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Provider request identifier, when supplied by the SDK/API
    /// </summary>
    public string? RequestId { get; set; }

    /// <summary>
    /// Service request identifier, when supplied by the SDK/API
    /// </summary>
    public string? ServiceRequestId { get; set; }

    /// <summary>
    /// Token usage reported by the provider
    /// </summary>
    public TokenUsage? Usage { get; set; }

    /// <summary>
    /// LLM call duration in milliseconds
    /// </summary>
    public double? DurationMs { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a LlmCompletePayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmCompletePayload instance.</returns>
    public static LlmCompletePayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new LlmCompletePayload();


        if (data.TryGetValue("requestId", out var requestIdValue) && requestIdValue is not null)
        {
            instance.RequestId = requestIdValue?.ToString()!;
        }

        if (data.TryGetValue("serviceRequestId", out var serviceRequestIdValue) && serviceRequestIdValue is not null)
        {
            instance.ServiceRequestId = serviceRequestIdValue?.ToString()!;
        }

        if (data.TryGetValue("usage", out var usageValue) && usageValue is not null)
        {
            instance.Usage = TokenUsage.Load(usageValue.GetDictionary(TokenUsage.ShorthandProperty), context);
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
    /// Save the LlmCompletePayload instance to a dictionary.
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


        if (obj.ServiceRequestId is not null)
        {
            result["serviceRequestId"] = obj.ServiceRequestId;
        }


        if (obj.Usage is not null)
        {
            result["usage"] = obj.Usage?.Save(context);
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
    /// Convert the LlmCompletePayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the LlmCompletePayload instance to a JSON string.
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
    /// Load a LlmCompletePayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmCompletePayload instance.</returns>
    public static LlmCompletePayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a LlmCompletePayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded LlmCompletePayload instance.</returns>
    public static LlmCompletePayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
