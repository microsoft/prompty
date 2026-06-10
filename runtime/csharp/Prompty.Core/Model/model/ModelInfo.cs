// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Information about a model available from a provider. Used by provider-level
///
/// model discovery to report which models are available and their capabilities.
///
/// Not all providers return all fields — implementations SHOULD populate as
///
/// many fields as the provider's API supports and MAY enrich sparse results
///
/// from a built-in lookup table of known models.
/// </summary>
public partial class ModelInfo
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ModelInfo"/>.
    /// </summary>
#pragma warning disable CS8618
    public ModelInfo()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The model identifier (e.g., 'gpt-4o', 'claude-3-opus')
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Human-readable display name
    /// </summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// The organization or entity that owns the model
    /// </summary>
    public string? OwnedBy { get; set; }

    /// <summary>
    /// Maximum context window size in tokens
    /// </summary>
    public int? ContextWindow { get; set; }

    /// <summary>
    /// Input modalities the model accepts (e.g., 'text', 'image', 'audio')
    /// </summary>
    public IList<string>? InputModalities { get; set; }

    /// <summary>
    /// Output modalities the model can produce (e.g., 'text', 'audio')
    /// </summary>
    public IList<string>? OutputModalities { get; set; }

    /// <summary>
    /// Additional provider-specific properties
    /// </summary>
    public IDictionary<string, object>? AdditionalProperties { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a ModelInfo instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelInfo instance.</returns>
    public static ModelInfo Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ModelInfo();


        if (data.TryGetValue("id", out var idValue) && idValue is not null)
        {
            instance.Id = idValue?.ToString()!;
        }

        if (data.TryGetValue("displayName", out var displayNameValue) && displayNameValue is not null)
        {
            instance.DisplayName = displayNameValue?.ToString()!;
        }

        if (data.TryGetValue("ownedBy", out var ownedByValue) && ownedByValue is not null)
        {
            instance.OwnedBy = ownedByValue?.ToString()!;
        }

        if (data.TryGetValue("contextWindow", out var contextWindowValue) && contextWindowValue is not null)
        {
            instance.ContextWindow = Convert.ToInt32(contextWindowValue);
        }

        if (data.TryGetValue("inputModalities", out var inputModalitiesValue) && inputModalitiesValue is not null)
        {
            instance.InputModalities = (inputModalitiesValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
        }

        if (data.TryGetValue("outputModalities", out var outputModalitiesValue) && outputModalitiesValue is not null)
        {
            instance.OutputModalities = (outputModalitiesValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
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
    /// Save the ModelInfo instance to a dictionary.
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


        result["id"] = obj.Id;


        if (obj.DisplayName is not null)
        {
            result["displayName"] = obj.DisplayName;
        }


        if (obj.OwnedBy is not null)
        {
            result["ownedBy"] = obj.OwnedBy;
        }


        if (obj.ContextWindow is not null)
        {
            result["contextWindow"] = obj.ContextWindow;
        }


        if (obj.InputModalities is not null)
        {
            result["inputModalities"] = obj.InputModalities;
        }


        if (obj.OutputModalities is not null)
        {
            result["outputModalities"] = obj.OutputModalities;
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
    /// Convert the ModelInfo instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ModelInfo instance to a JSON string.
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
    /// Load a ModelInfo instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelInfo instance.</returns>
    public static ModelInfo FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ModelInfo instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ModelInfo instance.</returns>
    public static ModelInfo FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
