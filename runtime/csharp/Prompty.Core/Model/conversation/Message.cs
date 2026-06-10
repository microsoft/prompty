// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// A message in a conversation. Messages have a role and a list of content parts
///
/// representing the different modalities of the message content.
/// </summary>
public partial class Message : IMessageHelpers
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="Message"/>.
    /// </summary>
#pragma warning disable CS8618
    public Message()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The role of the message sender
    /// </summary>
    public Role Role { get; set; } = Role.User;

    /// <summary>
    /// The content parts of the message
    /// </summary>
    public IList<ContentPart> Parts { get; set; } = [];

    /// <summary>
    /// Optional metadata associated with the message
    /// </summary>
    public IDictionary<string, object> Metadata { get; set; } = new Dictionary<string, object>();



    #region Load Methods

    /// <summary>
    /// Load a Message instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Message instance.</returns>
    public static Message Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new Message();


        if (data.TryGetValue("role", out var roleValue) && roleValue is not null)
        {
            instance.Role = Enum.Parse<Role>(roleValue?.ToString()!, true);
        }

        if (data.TryGetValue("parts", out var partsValue) && partsValue is not null)
        {
            instance.Parts = LoadParts(partsValue, context);
        }

        if (data.TryGetValue("metadata", out var metadataValue) && metadataValue is not null)
        {
            instance.Metadata = metadataValue.GetDictionary()!;
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
    /// Save the Message instance to a dictionary.
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


        result["role"] = obj.Role.ToString().ToLowerInvariant();


        result["parts"] = SaveParts(obj.Parts, context);


        result["metadata"] = obj.Metadata;


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
    /// Convert the Message instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Message instance to a JSON string.
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
    /// Load a Message instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Message instance.</returns>
    public static Message FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Message instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Message instance.</returns>
    public static Message FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion

    #region Factory Methods

    /// <summary>
    /// Create a Message with preset field values.
    /// </summary>
    public static Message Assistant(string text)
    {
        return new Message { Role = Role.Assistant, Parts = new List<ContentPart> { new TextPart { Value = text } } };
    }

    /// <summary>
    /// Create a Message with preset field values.
    /// </summary>
    public static Message System(string text)
    {
        return new Message { Role = Role.System, Parts = new List<ContentPart> { new TextPart { Value = text } } };
    }

    /// <summary>
    /// Create a Message with preset field values.
    /// </summary>
    public static Message User(string text)
    {
        return new Message { Role = Role.User, Parts = new List<ContentPart> { new TextPart { Value = text } } };
    }

    #endregion
}

/// <summary>
/// Helper contract for <see cref="Message"/>.
///
/// Runtime implementations must provide these members on Message (via a
/// hand-written partial class). The C# compiler enforces conformance
/// because Message declares : IMessageHelpers.
/// </summary>
public partial interface IMessageHelpers
{
    /// <summary>
    /// Return plain string if all parts are text, else a list of content part dicts for wire serialization
    /// </summary>
    object ToTextContent();
    /// <summary>
    /// Concatenate all TextPart values joined by newline
    /// </summary>
    string Text { get; }
}
