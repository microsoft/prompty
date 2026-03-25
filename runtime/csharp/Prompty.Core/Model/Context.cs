// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Context for customizing the loading process of agent definitions.
/// Provides hooks for pre-processing input data before parsing and
/// post-processing output data after instantiation.
/// </summary>
public class LoadContext
{
    /// <summary>
    /// Optional callback to transform input data before parsing.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PreProcess { get; set; }

    /// <summary>
    /// Optional callback to transform the result after instantiation.
    /// </summary>
    public Func<object, object>? PostProcess { get; set; }

    /// <summary>
    /// Apply pre-processing to input data if a PreProcess callback is set.
    /// </summary>
    /// <param name="data">The raw input dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessInput(Dictionary<string, object?> data)
    {
        if (PreProcess is not null)
        {
            return PreProcess(data);
        }
        return data;
    }

    /// <summary>
    /// Apply post-processing to the result if a PostProcess callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the result.</typeparam>
    /// <param name="result">The instantiated object to process.</param>
    /// <returns>The processed result, or the original if no callback is set.</returns>
    public T ProcessOutput<T>(T result) where T : class
    {
        if (PostProcess is not null)
        {
            return (T)PostProcess(result);
        }
        return result;
    }
}

/// <summary>
/// Context for customizing the serialization process of agent definitions.
/// Provides hooks for pre-processing the object before serialization and
/// post-processing the dictionary after serialization.
/// </summary>
public class SaveContext
{
    /// <summary>
    /// Optional callback to transform the object before serialization.
    /// </summary>
    public Func<object, object>? PreSave { get; set; }

    /// <summary>
    /// Optional callback to transform the dictionary after serialization.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PostSave { get; set; }

    /// <summary>
    /// Output format for collections: "object" (name as key) or "array" (list of dicts).
    /// Defaults to "object".
    /// </summary>
    public string CollectionFormat { get; set; } = "object";

    /// <summary>
    /// Use shorthand scalar representation when possible (e.g., {"myTool": "function"}).
    /// Defaults to true.
    /// </summary>
    public bool UseShorthand { get; set; } = true;

    /// <summary>
    /// Apply pre-processing to the object if a PreSave callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the object.</typeparam>
    /// <param name="obj">The object to process before serialization.</param>
    /// <returns>The processed object, or the original if no callback is set.</returns>
    public T ProcessObject<T>(T obj) where T : class
    {
        if (PreSave is not null)
        {
            return (T)PreSave(obj);
        }
        return obj;
    }

    /// <summary>
    /// Apply post-processing to the dictionary if a PostSave callback is set.
    /// </summary>
    /// <param name="data">The serialized dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessDict(Dictionary<string, object?> data)
    {
        if (PostSave is not null)
        {
            return PostSave(data);
        }
        return data;
    }

    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly ISerializer s_yamlSerializer = new SerializerBuilder()
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    /// <summary>
    /// Convert the dictionary to a YAML string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <returns>The YAML string representation.</returns>
    public string ToYaml(Dictionary<string, object?> data)
    {
        return s_yamlSerializer.Serialize(data);
    }

    /// <summary>
    /// Convert the dictionary to a JSON string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation.</returns>
    public string ToJson(Dictionary<string, object?> data, bool indent = true)
    {
        var options = indent ? s_jsonOptions : new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        return JsonSerializer.Serialize(data, options);
    }
}
