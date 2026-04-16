// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// The result of a tool execution. Contains a list of content parts, enabling
    /// 
    /// rich tool results (text, images, files, audio) rather than just strings.
    /// 
    /// Implementations MUST support conversion from a plain string to a ToolResult
    /// 
    /// containing a single TextPart for backward compatibility.
    /// </summary>
public partial class ToolResult
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ToolResult"/>.
    /// </summary>
#pragma warning disable CS8618
    public ToolResult()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The content parts of the tool result
    /// </summary>
    public IList<ContentPart> Parts { get; set; } = [];



    #region Load Methods

    /// <summary>
    /// Load a ToolResult instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolResult instance.</returns>
    public static ToolResult Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ToolResult();


        if (data.TryGetValue("parts", out var partsValue) && partsValue is not null)
        {
            instance.Parts = LoadParts(partsValue, context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    /// <summary>
    /// Load a list of ContentPart from a dictionary or list.
    /// </summary>
    public static IList<ContentPart> LoadParts(object data, LoadContext? context)
    {
        var result = new List<ContentPart>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is IEnumerable<object>)
                {
                    throw new ArgumentException(
                        $"Invalid 'parts' format: key '{kvp.Key}' has an array value. " +
                        $"'parts' must be a flat list of objects or a name-keyed dict — " +
                        "not a nested {" + kvp.Key + ": [...]} structure.");
                }
                var itemDict = kvp.Value.GetDictionary();
                if (itemDict.Count > 0)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(ContentPart.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar, use it as the primary property
                    var newDict = new Dictionary<string, object?>
                    {
                        ["name"] = kvp.Key,
                        ["kind"] = kvp.Value
                    };
                    result.Add(ContentPart.Load(newDict, context));
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                var itemDict = item.GetDictionary(ContentPart.ShorthandProperty);
                if (itemDict.Count > 0)
                {
                    result.Add(ContentPart.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the ToolResult instance to a dictionary.
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


        result["parts"] = SaveParts(obj.Parts, context);


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Save a list of ContentPart to object or array format.
    /// </summary>
    public static object SaveParts(IList<ContentPart> items, SaveContext? context)
    {
        context ??= new SaveContext();

        // This collection type does not have a 'name' property, only array format is supported
        return items.Select(item => item.Save(context)).ToList();

    }


    /// <summary>
    /// Convert the ToolResult instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ToolResult instance to a JSON string.
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
    /// Load a ToolResult instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolResult instance.</returns>
    public static ToolResult FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ToolResult instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolResult instance.</returns>
    public static ToolResult FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion

    #region Factory Methods

    /// <summary>
    /// Create a ToolResult with preset field values.
    /// </summary>
    public static ToolResult Text(string value)
    {
        return new ToolResult { Parts = new List<ContentPart> { new TextPart { Value = value } } };
    }

    #endregion

    #region Helpers — implement these in a partial class extension

    // The following helpers should be implemented in a separate partial class file:
    // - text(): string — Concatenate all TextPart values joined by newline

    #endregion
}
