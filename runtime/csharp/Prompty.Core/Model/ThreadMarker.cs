// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Positional marker for conversation history insertion during template rendering.
/// 
/// During `prepare()`, nonce strings in rendered text are replaced with
/// 
/// ThreadMarker objects. The pipeline then replaces them with actual
/// 
/// conversation messages from the inputs.
/// </summary>
public partial class ThreadMarker
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ThreadMarker"/>.
    /// </summary>
#pragma warning disable CS8618
    public ThreadMarker()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The input property name (e.g. 'conversation')
    /// </summary>
    public string Name { get; set; } = "thread";

    /// <summary>
    /// The rich kind ('thread', 'image', 'file', 'audio')
    /// </summary>
    public string Kind { get; set; } = "thread";



    #region Load Methods

    /// <summary>
    /// Load a ThreadMarker instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ThreadMarker instance.</returns>
    public static ThreadMarker Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ThreadMarker();


        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
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
    /// Save the ThreadMarker instance to a dictionary.
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


        result["name"] = obj.Name;


        result["kind"] = obj.Kind;


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ThreadMarker instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ThreadMarker instance to a JSON string.
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
    /// Load a ThreadMarker instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ThreadMarker instance.</returns>
    public static ThreadMarker FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ThreadMarker instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ThreadMarker instance.</returns>
    public static ThreadMarker FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
