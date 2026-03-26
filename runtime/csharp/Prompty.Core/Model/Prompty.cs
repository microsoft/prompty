// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// A Prompty is a markdown file format for LLM prompts. The frontmatter defines
/// structured metadata including model configuration, input/output schemas, tools,
/// and template settings. The markdown body becomes the instructions.
/// 
/// This is the single root type for the Prompty schema — there is no abstract base
/// class or kind discriminator. A .prompty file always produces a Prompty instance.
/// </summary>
public class Prompty
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="Prompty"/>.
    /// </summary>
#pragma warning disable CS8618
    public Prompty()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Human-readable name of the prompt
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Display name for UI purposes
    /// </summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// Description of the prompt's purpose
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Additional metadata including authors, tags, and other arbitrary properties
    /// </summary>
    public IDictionary<string, object>? Metadata { get; set; }

    /// <summary>
    /// Input parameters that participate in template rendering
    /// </summary>
    public IList<Property>? Inputs { get; set; }

    /// <summary>
    /// Expected output format and structure
    /// </summary>
    public IList<Property>? Outputs { get; set; }

    /// <summary>
    /// AI model configuration
    /// </summary>
    public Model Model { get; set; }

    /// <summary>
    /// Tools available for extended functionality
    /// </summary>
    public IList<Tool>? Tools { get; set; }

    /// <summary>
    /// Template configuration for prompt rendering
    /// </summary>
    public Template? Template { get; set; }

    /// <summary>
    /// Clear directions on what the prompt should do. In .prompty files, this comes from the markdown body.
    /// </summary>
    public string? Instructions { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Prompty instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Prompty instance.</returns>
    public static Prompty Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new Prompty();


        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("displayName", out var displayNameValue) && displayNameValue is not null)
        {
            instance.DisplayName = displayNameValue?.ToString()!;
        }

        if (data.TryGetValue("description", out var descriptionValue) && descriptionValue is not null)
        {
            instance.Description = descriptionValue?.ToString()!;
        }

        if (data.TryGetValue("metadata", out var metadataValue) && metadataValue is not null)
        {
            instance.Metadata = metadataValue.GetDictionary()!;
        }

        if (data.TryGetValue("inputs", out var inputsValue) && inputsValue is not null)
        {
            instance.Inputs = LoadInputs(inputsValue, context);
        }

        if (data.TryGetValue("outputs", out var outputsValue) && outputsValue is not null)
        {
            instance.Outputs = LoadOutputs(outputsValue, context);
        }

        if (data.TryGetValue("model", out var modelValue) && modelValue is not null)
        {
            instance.Model = Model.Load(modelValue.GetDictionary(), context);
        }

        if (data.TryGetValue("tools", out var toolsValue) && toolsValue is not null)
        {
            instance.Tools = LoadTools(toolsValue, context);
        }

        if (data.TryGetValue("template", out var templateValue) && templateValue is not null)
        {
            instance.Template = Template.Load(templateValue.GetDictionary(), context);
        }

        if (data.TryGetValue("instructions", out var instructionsValue) && instructionsValue is not null)
        {
            instance.Instructions = instructionsValue?.ToString()!;
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
    public static IList<Property> LoadInputs(object data, LoadContext? context)
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
                    // Value is a scalar — let Load() infer kind from value
                    var prop = Property.Load(kvp.Value, context);
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
                    result.Add(Property.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    /// <summary>
    /// Load a list of Property from a dictionary or list.
    /// </summary>
    public static IList<Property> LoadOutputs(object data, LoadContext? context)
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
                    // Value is a scalar — let Load() infer kind from value
                    var prop = Property.Load(kvp.Value, context);
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
                    result.Add(Property.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    /// <summary>
    /// Load a list of Tool from a dictionary or list.
    /// </summary>
    public static IList<Tool> LoadTools(object data, LoadContext? context)
    {
        var result = new List<Tool>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is Dictionary<string, object?> itemDict)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(Tool.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar — let Load() infer kind from value
                    var prop = Tool.Load(kvp.Value, context);
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
                    result.Add(Tool.Load(itemDict, context));
                }
            }
        }

        return result;
    }



    #endregion

    #region Save Methods

    /// <summary>
    /// Save the Prompty instance to a dictionary.
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

        if (obj.DisplayName is not null)
        {
            result["displayName"] = obj.DisplayName;
        }

        if (obj.Description is not null)
        {
            result["description"] = obj.Description;
        }

        if (obj.Metadata is not null)
        {
            result["metadata"] = obj.Metadata;
        }

        if (obj.Inputs is not null)
        {
            result["inputs"] = SaveInputs(obj.Inputs, context);
        }

        if (obj.Outputs is not null)
        {
            result["outputs"] = SaveOutputs(obj.Outputs, context);
        }

        if (obj.Model is not null)
        {
            result["model"] = obj.Model?.Save(context);
        }

        if (obj.Tools is not null)
        {
            result["tools"] = SaveTools(obj.Tools, context);
        }

        if (obj.Template is not null)
        {
            result["template"] = obj.Template?.Save(context);
        }

        if (obj.Instructions is not null)
        {
            result["instructions"] = obj.Instructions;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Save a list of Property to object or array format.
    /// </summary>
    public static object SaveInputs(IList<Property> items, SaveContext? context)
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
    /// Save a list of Property to object or array format.
    /// </summary>
    public static object SaveOutputs(IList<Property> items, SaveContext? context)
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
    /// Save a list of Tool to object or array format.
    /// </summary>
    public static object SaveTools(IList<Tool> items, SaveContext? context)
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
                if (context.UseShorthand && Tool.ShorthandProperty is string shorthandProp)
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
    /// Convert the Prompty instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Prompty instance to a JSON string.
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
    /// Load a Prompty instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Prompty instance.</returns>
    public static Prompty FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Prompty instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Prompty instance.</returns>
    public static Prompty FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
