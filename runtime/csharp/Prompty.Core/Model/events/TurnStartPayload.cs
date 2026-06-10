// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Payload for "turn_start" events — a turn is beginning.
/// </summary>
public partial class TurnStartPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="TurnStartPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public TurnStartPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the loaded prompt/agent, when available
    /// </summary>
    public string? Agent { get; set; }

    /// <summary>
    /// Input values supplied to the turn after host-side sanitization
    /// </summary>
    public IDictionary<string, object>? Inputs { get; set; }

    /// <summary>
    /// Configured maximum tool-call iterations
    /// </summary>
    public int? MaxIterations { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a TurnStartPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnStartPayload instance.</returns>
    public static TurnStartPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new TurnStartPayload();


        if (data.TryGetValue("agent", out var agentValue) && agentValue is not null)
        {
            instance.Agent = agentValue?.ToString()!;
        }

        if (data.TryGetValue("inputs", out var inputsValue) && inputsValue is not null)
        {
            instance.Inputs = inputsValue.GetDictionary()!;
        }

        if (data.TryGetValue("maxIterations", out var maxIterationsValue) && maxIterationsValue is not null)
        {
            instance.MaxIterations = Convert.ToInt32(maxIterationsValue);
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
    /// Save the TurnStartPayload instance to a dictionary.
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


        if (obj.Agent is not null)
        {
            result["agent"] = obj.Agent;
        }


        if (obj.Inputs is not null)
        {
            result["inputs"] = obj.Inputs;
        }


        if (obj.MaxIterations is not null)
        {
            result["maxIterations"] = obj.MaxIterations;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the TurnStartPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the TurnStartPayload instance to a JSON string.
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
    /// Load a TurnStartPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnStartPayload instance.</returns>
    public static TurnStartPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a TurnStartPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnStartPayload instance.</returns>
    public static TurnStartPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
