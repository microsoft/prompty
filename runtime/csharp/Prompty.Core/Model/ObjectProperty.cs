// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Represents an object property.
/// This extends the base Property model to represent a structured object.
/// </summary>
public class ObjectProperty : Property
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ObjectProperty"/>.
    /// </summary>
#pragma warning disable CS8618
    public ObjectProperty()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";

    /// <summary>
    /// The properties contained in the object
    /// </summary>
    public IList<Property> Properties { get; set; } = [];


    #region Load Methods

    /// <summary>
    /// Load a ObjectProperty instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ObjectProperty instance.</returns>
    public new static ObjectProperty Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ObjectProperty();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("properties", out var propertiesValue) && propertiesValue is not null)
        {
            instance.Properties = LoadProperties(propertiesValue, context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    /// <summary>
    /// Load a list of Property from a dictionary or list.
    /// </summary>
    public static IList<Property> LoadProperties(object data, LoadContext? context)
    {
        var result = new List<Property>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is Dictionary<string, object?> itemDict)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(Property.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar, use it as the primary property
                    var newDict = new Dictionary<string, object?>
                    {
                        ["name"] = kvp.Key,
                        ["example"] = kvp.Value
                    };
                    result.Add(Property.Load(newDict, context));
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                if (item is Dictionary<string, object?> itemDict)
                {
                    result.Add(Property.Load(itemDict, context));
                }
            }
        }

        return result;
    }



    #endregion

    #region Save Methods

    /// <summary>
    /// Save the ObjectProperty instance to a dictionary.
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


        if (obj.Kind is not null)
        {
            result["kind"] = obj.Kind;
        }

        if (obj.Properties is not null)
        {
            result["properties"] = SaveProperties(obj.Properties, context);
        }


        return result;
    }


    /// <summary>
    /// Save a list of Property to object or array format.
    /// </summary>
    public static object SaveProperties(IList<Property> items, SaveContext? context)
    {
        context ??= new SaveContext();


        if (context.CollectionFormat == "array")
        {
            return items.Select(item => item.Save(context)).ToList();
        }

        // Object format: use name as key
        var result = new Dictionary<string, object?>();
        foreach (var item in items)
        {
            var itemData = item.Save(context);
            if (itemData.TryGetValue("name", out var nameValue) && nameValue is string name)
            {
                itemData.Remove("name");

                // Check if we can use shorthand
                if (context.UseShorthand && Property.ShorthandProperty is string shorthandProp)
                {
                    if (itemData.Count == 1 && itemData.ContainsKey(shorthandProp))
                    {
                        result[name] = itemData[shorthandProp];
                        continue;
                    }
                }
                result[name] = itemData;
            }
            else
            {
                // No name, can't use object format for this item
                throw new InvalidOperationException("Cannot save item in object format: missing 'name' property");
            }
        }
        return result;

    }


    /// <summary>
    /// Convert the ObjectProperty instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ObjectProperty instance to a JSON string.
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
    /// Load a ObjectProperty instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ObjectProperty instance.</returns>
    public new static ObjectProperty FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ObjectProperty instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ObjectProperty instance.</returns>
    public new static ObjectProperty FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
