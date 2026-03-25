// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Template format definition
/// </summary>
public class Format
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => "kind";

    /// <summary>
    /// Initializes a new instance of <see cref="Format"/>.
    /// </summary>
#pragma warning disable CS8618
    public Format()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Whether the template can emit structural text for parsing output
    /// </summary>
    public bool? Strict { get; set; }

    /// <summary>
    /// Options for the template engine
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Format instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Format instance.</returns>
    public static Format Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }

        // Note: Alternate (shorthand) representations are handled by the converter


        // Create new instance
        var instance = new Format();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("strict", out var strictValue) && strictValue is not null)
        {
            instance.Strict = Convert.ToBoolean(strictValue);
        }

        if (data.TryGetValue("options", out var optionsValue) && optionsValue is not null)
        {
            instance.Options = optionsValue.GetDictionary()!;
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
    /// Save the Format instance to a dictionary.
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


        if (obj.Kind is not null)
        {
            result["kind"] = obj.Kind;
        }

        if (obj.Strict is not null)
        {
            result["strict"] = obj.Strict;
        }

        if (obj.Options is not null)
        {
            result["options"] = obj.Options;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the Format instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Format instance to a JSON string.
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
    /// Load a Format instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Format instance.</returns>
    public static Format FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        // Handle alternate representations
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            var value = JsonUtils.GetJsonElementValue(doc.RootElement);
            dict = value switch
            {
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["kind"] = value
                }
            };
        }
        else
        {
            dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
                ?? throw new ArgumentException("Failed to parse JSON as dictionary");
        }

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Format instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Format instance.</returns>
    public static Format FromYaml(string yaml, LoadContext? context = null)
    {
        // Handle alternate representations - try object first, fall back to scalar
        Dictionary<string, object?>? dictResult = null;
        try
        {
            dictResult = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml);
        }
        catch (YamlDotNet.Core.YamlException)
        {
            // Not a dictionary, will be handled as scalar below
        }

        Dictionary<string, object?> dict;
        if (dictResult is not null)
        {
            dict = dictResult;
        }
        else
        {
            // Parse as scalar with proper type inference
            var parsed = YamlUtils.ParseScalar(yaml);
            dict = parsed switch
            {
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["kind"] = parsed
                }
            };
        }

        return Load(dict, context);
    }

    #endregion
}
