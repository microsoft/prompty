// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// Represents a local function tool.
    /// </summary>
public partial class FunctionTool : Tool
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="FunctionTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public FunctionTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for function tools
    /// </summary>
    public override string Kind { get; set; } = "function";

    /// <summary>
    /// Parameters accepted by the function tool
    /// </summary>
    public IList<Property> Parameters { get; set; } = [];

    /// <summary>
    /// Indicates whether the function tool enforces strict validation on its parameters
    /// </summary>
    public bool? Strict { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a FunctionTool instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FunctionTool instance.</returns>
    public new static FunctionTool Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new FunctionTool();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("parameters", out var parametersValue) && parametersValue is not null)
        {
            instance.Parameters = LoadParameters(parametersValue, context);
        }

        if (data.TryGetValue("strict", out var strictValue) && strictValue is not null)
        {
            instance.Strict = Convert.ToBoolean(strictValue);
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
    public static IList<Property> LoadParameters(object data, LoadContext? context)
    {
        var result = new List<Property>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is IEnumerable<object>)
                {
                    throw new ArgumentException(
                        $"Invalid 'parameters' format: key '{kvp.Key}' has an array value. " +
                        $"'parameters' must be a flat list of objects or a name-keyed dict — " +
                        "not a nested {" + kvp.Key + ": [...]} structure.");
                }
                var itemDict = kvp.Value.GetDictionary();
                if (itemDict.Count > 0)
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
                var itemDict = item.GetDictionary(Property.ShorthandProperty);
                if (itemDict.Count > 0)
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
    /// Save the FunctionTool instance to a dictionary.
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


        result["parameters"] = SaveParameters(obj.Parameters, context);


        if (obj.Strict is not null)
        {
            result["strict"] = obj.Strict;
        }


        return result;
    }


    /// <summary>
    /// Save a list of Property to object or array format.
    /// </summary>
    public static object SaveParameters(IList<Property> items, SaveContext? context)
    {
        context ??= new SaveContext();

        // This collection type does not have a 'name' property, only array format is supported
        return items.Select(item => item.Save(context)).ToList();

    }


    /// <summary>
    /// Convert the FunctionTool instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the FunctionTool instance to a JSON string.
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
    /// Load a FunctionTool instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FunctionTool instance.</returns>
    public new static FunctionTool FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a FunctionTool instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FunctionTool instance.</returns>
    public new static FunctionTool FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
