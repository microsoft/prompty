// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "retry" events — a transient operation will be retried.
/// </summary>
public partial class RetryPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="RetryPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public RetryPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Operation being retried
    /// </summary>
    public string Operation { get; set; } = string.Empty;

    /// <summary>
    /// Attempt number about to run
    /// </summary>
    public int Attempt { get; set; }

    /// <summary>
    /// Maximum configured attempts
    /// </summary>
    public int? MaxAttempts { get; set; }

    /// <summary>
    /// Backoff delay before the next attempt in milliseconds
    /// </summary>
    public double? DelayMs { get; set; }

    /// <summary>
    /// Reason for the retry
    /// </summary>
    public string? Reason { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a RetryPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded RetryPayload instance.</returns>
    public static RetryPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new RetryPayload();


        if (data.TryGetValue("operation", out var operationValue) && operationValue is not null)
        {
            instance.Operation = operationValue?.ToString()!;
        }

        if (data.TryGetValue("attempt", out var attemptValue) && attemptValue is not null)
        {
            instance.Attempt = Convert.ToInt32(attemptValue);
        }

        if (data.TryGetValue("maxAttempts", out var maxAttemptsValue) && maxAttemptsValue is not null)
        {
            instance.MaxAttempts = Convert.ToInt32(maxAttemptsValue);
        }

        if (data.TryGetValue("delayMs", out var delayMsValue) && delayMsValue is not null)
        {
            instance.DelayMs = Convert.ToDouble(delayMsValue);
        }

        if (data.TryGetValue("reason", out var reasonValue) && reasonValue is not null)
        {
            instance.Reason = reasonValue?.ToString()!;
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
    /// Save the RetryPayload instance to a dictionary.
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


        result["operation"] = obj.Operation;


        result["attempt"] = obj.Attempt;


        if (obj.MaxAttempts is not null)
        {
            result["maxAttempts"] = obj.MaxAttempts;
        }


        if (obj.DelayMs is not null)
        {
            result["delayMs"] = obj.DelayMs;
        }


        if (obj.Reason is not null)
        {
            result["reason"] = obj.Reason;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the RetryPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the RetryPayload instance to a JSON string.
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
    /// Load a RetryPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded RetryPayload instance.</returns>
    public static RetryPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a RetryPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded RetryPayload instance.</returns>
    public static RetryPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
