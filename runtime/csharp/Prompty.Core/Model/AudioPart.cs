// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// An audio content part. The source may be a URL or base64-encoded data.
    /// </summary>
public partial class AudioPart : ContentPart
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="AudioPart"/>.
    /// </summary>
#pragma warning disable CS8618
    public AudioPart()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for audio content
    /// </summary>
    public override string Kind { get; set; } = "audio";

    /// <summary>
    /// URL or base64-encoded audio data
    /// </summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// MIME type of the audio (e.g., 'audio/wav')
    /// </summary>
    public string? MediaType { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a AudioPart instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AudioPart instance.</returns>
    public new static AudioPart Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new AudioPart();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("source", out var sourceValue) && sourceValue is not null)
        {
            instance.Source = sourceValue?.ToString()!;
        }

        if (data.TryGetValue("mediaType", out var mediaTypeValue) && mediaTypeValue is not null)
        {
            instance.MediaType = mediaTypeValue?.ToString()!;
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
    /// Save the AudioPart instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public override Dictionary<string, object?> Save(SaveContext? context = null)
    {
        var obj = this;
        if (context is not null)
        {
            obj = context.ProcessObject(obj);
        }


        // Start with parent class properties
        var result = base.Save(context);


        result["kind"] = obj.Kind;


        result["source"] = obj.Source;


        if (obj.MediaType is not null)
        {
            result["mediaType"] = obj.MediaType;
        }


        return result;
    }


    /// <summary>
    /// Convert the AudioPart instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the AudioPart instance to a JSON string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation of this instance.</returns>
    public new string ToJson(SaveContext? context = null, bool indent = true)
    {
        context ??= new SaveContext();
        return context.ToJson(Save(context), indent);
    }

    /// <summary>
    /// Load a AudioPart instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AudioPart instance.</returns>
    public new static AudioPart FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a AudioPart instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AudioPart instance.</returns>
    public new static AudioPart FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
