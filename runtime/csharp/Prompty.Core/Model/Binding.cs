// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Represents a binding between an input property and a tool parameter.
/// </summary>
public class Binding
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => "input";

    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
#pragma warning disable CS8618
    public Binding()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the binding
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The input property that will be bound to the tool parameter argument
    /// </summary>
    public string Input { get; set; } = string.Empty;


    #region Load Methods

    /// <summary>
    /// Load a Binding instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Binding instance.</returns>
    public static Binding Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }

        // Note: Alternate (shorthand) representations are handled by the converter


        // Create new instance
        var instance = new Binding();


        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("input", out var inputValue) && inputValue is not null)
        {
            instance.Input = inputValue?.ToString()!;
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
    /// Save the Binding instance to a dictionary.
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


        if (obj.Name is not null)
        {
            result["name"] = obj.Name;
        }

        if (obj.Input is not null)
        {
            result["input"] = obj.Input;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the Binding instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Binding instance to a JSON string.
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
    /// Load a Binding instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Binding instance.</returns>
    public static Binding FromJson(string json, LoadContext? context = null)
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
                    ["input"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["input"] = value
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
    /// Load a Binding instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Binding instance.</returns>
    public static Binding FromYaml(string yaml, LoadContext? context = null)
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
                    ["input"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["input"] = parsed
                }
            };
        }

        return Load(dict, context);
    }

    #endregion
}
