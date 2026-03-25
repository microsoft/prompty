// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// Options for configuring the behavior of the AI model.
/// </summary>
public class ModelOptions
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
#pragma warning disable CS8618
    public ModelOptions()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The frequency penalty to apply to the model's output
    /// </summary>
    public float? FrequencyPenalty { get; set; }

    /// <summary>
    /// The maximum number of tokens to generate in the output
    /// </summary>
    public int? MaxOutputTokens { get; set; }

    /// <summary>
    /// The presence penalty to apply to the model's output
    /// </summary>
    public float? PresencePenalty { get; set; }

    /// <summary>
    /// A random seed for deterministic output
    /// </summary>
    public int? Seed { get; set; }

    /// <summary>
    /// The temperature to use for sampling
    /// </summary>
    public float? Temperature { get; set; }

    /// <summary>
    /// The top-K sampling value
    /// </summary>
    public int? TopK { get; set; }

    /// <summary>
    /// The top-P sampling value
    /// </summary>
    public float? TopP { get; set; }

    /// <summary>
    /// Stop sequences to end generation
    /// </summary>
    public IList<string>? StopSequences { get; set; }

    /// <summary>
    /// Whether to allow multiple tool calls in a single response
    /// </summary>
    public bool? AllowMultipleToolCalls { get; set; }

    /// <summary>
    /// Additional custom properties for model options
    /// </summary>
    public IDictionary<string, object>? AdditionalProperties { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a ModelOptions instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelOptions instance.</returns>
    public static ModelOptions Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ModelOptions();


        if (data.TryGetValue("frequencyPenalty", out var frequencyPenaltyValue) && frequencyPenaltyValue is not null)
        {
            instance.FrequencyPenalty = Convert.ToSingle(frequencyPenaltyValue);
        }

        if (data.TryGetValue("maxOutputTokens", out var maxOutputTokensValue) && maxOutputTokensValue is not null)
        {
            instance.MaxOutputTokens = Convert.ToInt32(maxOutputTokensValue);
        }

        if (data.TryGetValue("presencePenalty", out var presencePenaltyValue) && presencePenaltyValue is not null)
        {
            instance.PresencePenalty = Convert.ToSingle(presencePenaltyValue);
        }

        if (data.TryGetValue("seed", out var seedValue) && seedValue is not null)
        {
            instance.Seed = Convert.ToInt32(seedValue);
        }

        if (data.TryGetValue("temperature", out var temperatureValue) && temperatureValue is not null)
        {
            instance.Temperature = Convert.ToSingle(temperatureValue);
        }

        if (data.TryGetValue("topK", out var topKValue) && topKValue is not null)
        {
            instance.TopK = Convert.ToInt32(topKValue);
        }

        if (data.TryGetValue("topP", out var topPValue) && topPValue is not null)
        {
            instance.TopP = Convert.ToSingle(topPValue);
        }

        if (data.TryGetValue("stopSequences", out var stopSequencesValue) && stopSequencesValue is not null)
        {
            instance.StopSequences = (stopSequencesValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
        }

        if (data.TryGetValue("allowMultipleToolCalls", out var allowMultipleToolCallsValue) && allowMultipleToolCallsValue is not null)
        {
            instance.AllowMultipleToolCalls = Convert.ToBoolean(allowMultipleToolCallsValue);
        }

        if (data.TryGetValue("additionalProperties", out var additionalPropertiesValue) && additionalPropertiesValue is not null)
        {
            instance.AdditionalProperties = additionalPropertiesValue.GetDictionary()!;
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
    /// Save the ModelOptions instance to a dictionary.
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


        if (obj.FrequencyPenalty is not null)
        {
            result["frequencyPenalty"] = obj.FrequencyPenalty;
        }

        if (obj.MaxOutputTokens is not null)
        {
            result["maxOutputTokens"] = obj.MaxOutputTokens;
        }

        if (obj.PresencePenalty is not null)
        {
            result["presencePenalty"] = obj.PresencePenalty;
        }

        if (obj.Seed is not null)
        {
            result["seed"] = obj.Seed;
        }

        if (obj.Temperature is not null)
        {
            result["temperature"] = obj.Temperature;
        }

        if (obj.TopK is not null)
        {
            result["topK"] = obj.TopK;
        }

        if (obj.TopP is not null)
        {
            result["topP"] = obj.TopP;
        }

        if (obj.StopSequences is not null)
        {
            result["stopSequences"] = obj.StopSequences;
        }

        if (obj.AllowMultipleToolCalls is not null)
        {
            result["allowMultipleToolCalls"] = obj.AllowMultipleToolCalls;
        }

        if (obj.AdditionalProperties is not null)
        {
            result["additionalProperties"] = obj.AdditionalProperties;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ModelOptions instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ModelOptions instance to a JSON string.
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
    /// Load a ModelOptions instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelOptions instance.</returns>
    public static ModelOptions FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ModelOptions instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelOptions instance.</returns>
    public static ModelOptions FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
