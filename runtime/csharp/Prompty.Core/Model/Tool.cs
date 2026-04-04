// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// Represents a tool that can be used in prompts.
/// </summary>
public abstract class Tool
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="Tool"/>.
    /// </summary>
#pragma warning disable CS8618
    protected Tool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the tool. If a function tool, this is the function name, otherwise it is the type
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The kind identifier for the tool
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the tool for metadata purposes
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Tool argument bindings to input properties
    /// </summary>
    public IList<Binding>? Bindings { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Tool instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Tool instance.</returns>
    public static Tool Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Load polymorphic Tool instance
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

        if (data.TryGetValue("bindings", out var bindingsValue) && bindingsValue is not null)
        {
            instance.Bindings = LoadBindings(bindingsValue, context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    /// <summary>
    /// Load a list of Binding from a dictionary or list.
    /// </summary>
    public static IList<Binding> LoadBindings(object data, LoadContext? context)
    {
        var result = new List<Binding>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is Dictionary<string, object?> itemDict)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(Binding.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar — let Load() infer kind from value
                    var prop = Binding.Load(kvp.Value, context);
                    prop.Name = kvp.Key;
                    result.Add(prop);
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                if (item is Dictionary<string, object?> itemDict)
                {
                    result.Add(Binding.Load(itemDict, context));
                }
            }
        }

        return result;
    }



    /// <summary>
    /// Load polymorphic Tool based on discriminator.
    /// </summary>
    private static Tool LoadKind(Dictionary<string, object?> data, LoadContext? context)
    {
        if (data.TryGetValue("kind", out var discriminatorValue) && discriminatorValue is not null)
        {
            var discriminator = discriminatorValue.ToString()?.ToLowerInvariant();
            return discriminator switch
            {
                "function" => FunctionTool.Load(data, context),
                "mcp" => McpTool.Load(data, context),
                "openapi" => OpenApiTool.Load(data, context),
                "prompty" => PromptyTool.Load(data, context),
                _ => CustomTool.Load(data, context),
            };
        }

        throw new ArgumentException("Missing Tool discriminator property: 'kind'");

    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the Tool instance to a dictionary.
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

        if (obj.Bindings is not null)
        {
            result["bindings"] = SaveBindings(obj.Bindings, context);
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Save a list of Binding to object or array format.
    /// </summary>
    public static object SaveBindings(IList<Binding> items, SaveContext? context)
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
                if (context.UseShorthand && Binding.ShorthandProperty is string shorthandProp)
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
    /// Convert the Tool instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Tool instance to a JSON string.
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
    /// Load a Tool instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Tool instance.</returns>
    public static Tool FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Tool instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Tool instance.</returns>
    public static Tool FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
