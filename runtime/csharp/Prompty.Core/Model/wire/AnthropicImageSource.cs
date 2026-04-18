// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Source descriptor for an Anthropic base64 image.
/// </summary>
public partial class AnthropicImageSource
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="AnthropicImageSource"/>.
    /// </summary>
#pragma warning disable CS8618
    public AnthropicImageSource()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The encoding type (always 'base64' for inline images)
    /// </summary>
    public string Type { get; set; } = "base64";

    /// <summary>
    /// The MIME type of the image (e.g., 'image/png', 'image/jpeg')
    /// </summary>
    public string MediaType { get; set; } = string.Empty;

    /// <summary>
    /// The base64-encoded image data
    /// </summary>
    public string Data { get; set; } = string.Empty;



    #region Load Methods

    /// <summary>
    /// Load a AnthropicImageSource instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicImageSource instance.</returns>
    public static AnthropicImageSource Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new AnthropicImageSource();


        if (data.TryGetValue("type", out var typeValue) && typeValue is not null)
        {
            instance.Type = typeValue?.ToString()!;
        }

        if (data.TryGetValue("media_type", out var media_typeValue) && media_typeValue is not null)
        {
            instance.MediaType = media_typeValue?.ToString()!;
        }

        if (data.TryGetValue("data", out var dataValue) && dataValue is not null)
        {
            instance.Data = dataValue?.ToString()!;
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
    /// Save the AnthropicImageSource instance to a dictionary.
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


        result["type"] = obj.Type;


        result["media_type"] = obj.MediaType;


        result["data"] = obj.Data;


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the AnthropicImageSource instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the AnthropicImageSource instance to a JSON string.
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
    /// Load a AnthropicImageSource instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicImageSource instance.</returns>
    public static AnthropicImageSource FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a AnthropicImageSource instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicImageSource instance.</returns>
    public static AnthropicImageSource FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
