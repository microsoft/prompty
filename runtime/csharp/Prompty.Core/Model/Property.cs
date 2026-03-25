// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Represents a single property.
/// 
/// - This model defines the structure of properties that can be used in prompts,
/// including their type, description, whether they are required, and other attributes.
/// - It allows for the definition of dynamic inputs that can be filled with data
/// and processed to generate prompts for AI models.
/// </summary>
public class Property
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => "example";

    /// <summary>
    /// Initializes a new instance of <see cref="Property"/>.
    /// </summary>
#pragma warning disable CS8618
    public Property()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the property
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data type of the input property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the input property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the property is required
    /// </summary>
    public bool? Required { get; set; }

    /// <summary>
    /// The default value of the property - this represents the default value if none is provided
    /// </summary>
    public object? Default { get; set; }

    /// <summary>
    /// Example value used for either initialization or tooling
    /// </summary>
    public object? Example { get; set; }

    /// <summary>
    /// Allowed enumeration values for the property
    /// </summary>
    public IList<object>? EnumValues { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Property instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Property instance.</returns>
    public static Property Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }

        // Note: Alternate (shorthand) representations are handled by the converter


        // Load polymorphic Property instance
        var instance = LoadKind(data, context);


        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("description", out var descriptionValue) && descriptionValue is not null)
        {
            instance.Description = descriptionValue?.ToString()!;
        }

        if (data.TryGetValue("required", out var requiredValue) && requiredValue is not null)
        {
            instance.Required = Convert.ToBoolean(requiredValue);
        }

        if (data.TryGetValue("default", out var defaultValue) && defaultValue is not null)
        {
            instance.Default = defaultValue;
        }

        if (data.TryGetValue("example", out var exampleValue) && exampleValue is not null)
        {
            instance.Example = exampleValue;
        }

        if (data.TryGetValue("enumValues", out var enumValuesValue) && enumValuesValue is not null)
        {
            instance.EnumValues = (enumValuesValue as IEnumerable<object>)?.ToList() ?? [];
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }



    /// <summary>
    /// Load polymorphic Property based on discriminator.
    /// </summary>
    private static Property LoadKind(Dictionary<string, object?> data, LoadContext? context)
    {
        if (data.TryGetValue("kind", out var discriminatorValue) && discriminatorValue is not null)
        {
            var discriminator = discriminatorValue.ToString()?.ToLowerInvariant();
            return discriminator switch
            {
                "array" => ArrayProperty.Load(data, context),
                "object" => ObjectProperty.Load(data, context),
                _ => new Property(),
            };
        }

        return new Property();

    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the Property instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public virtual Dictionary<string, object?> Save(SaveContext? context = null)
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

        if (obj.Kind is not null)
        {
            result["kind"] = obj.Kind;
        }

        if (obj.Description is not null)
        {
            result["description"] = obj.Description;
        }

        if (obj.Required is not null)
        {
            result["required"] = obj.Required;
        }

        if (obj.Default is not null)
        {
            result["default"] = obj.Default;
        }

        if (obj.Example is not null)
        {
            result["example"] = obj.Example;
        }

        if (obj.EnumValues is not null)
        {
            result["enumValues"] = obj.EnumValues;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the Property instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Property instance to a JSON string.
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
    /// Load a Property instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Property instance.</returns>
    public static Property FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        // Handle alternate representations
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            var value = JsonUtils.GetJsonElementValue(doc.RootElement);
            dict = value switch
            {
                bool boolValue => new Dictionary<string, object?>
                {
                    ["kind"] = "boolean",
                    ["example"] = boolValue,
                },
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = "string",
                    ["example"] = stringValue,
                },
                float floatValue => new Dictionary<string, object?>
                {
                    ["kind"] = "float",
                    ["example"] = floatValue,
                },
                int intValue => new Dictionary<string, object?>
                {
                    ["kind"] = "integer",
                    ["example"] = intValue,
                },
                long longValue => new Dictionary<string, object?>
                {
                    ["kind"] = "integer",
                    ["example"] = longValue,
                },
                double doubleValue => new Dictionary<string, object?>
                {
                    ["kind"] = "float",
                    ["example"] = doubleValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["example"] = value
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
    /// Load a Property instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Property instance.</returns>
    public static Property FromYaml(string yaml, LoadContext? context = null)
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
                bool boolValue => new Dictionary<string, object?>
                {
                    ["kind"] = "boolean",
                    ["example"] = boolValue,
                },
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = "string",
                    ["example"] = stringValue,
                },
                float floatValue => new Dictionary<string, object?>
                {
                    ["kind"] = "float",
                    ["example"] = floatValue,
                },
                int intValue => new Dictionary<string, object?>
                {
                    ["kind"] = "integer",
                    ["example"] = intValue,
                },
                long longValue => new Dictionary<string, object?>
                {
                    ["kind"] = "integer",
                    ["example"] = longValue,
                },
                double doubleValue => new Dictionary<string, object?>
                {
                    ["kind"] = "float",
                    ["example"] = doubleValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["example"] = parsed
                }
            };
        }

        return Load(dict, context);
    }

    #endregion
}
