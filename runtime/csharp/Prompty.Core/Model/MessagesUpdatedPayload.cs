// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// Payload for "messages_updated" events — the conversation state has changed.
    /// </summary>
public partial class MessagesUpdatedPayload
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="MessagesUpdatedPayload"/>.
    /// </summary>
#pragma warning disable CS8618
    public MessagesUpdatedPayload()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The current full message list after the update
    /// </summary>
    public IList<Message> Messages { get; set; } = [];



    #region Load Methods

    /// <summary>
    /// Load a MessagesUpdatedPayload instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded MessagesUpdatedPayload instance.</returns>
    public static MessagesUpdatedPayload Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new MessagesUpdatedPayload();


        if (data.TryGetValue("messages", out var messagesValue) && messagesValue is not null)
        {
            instance.Messages = LoadMessages(messagesValue, context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    /// <summary>
    /// Load a list of Message from a dictionary or list.
    /// </summary>
    public static IList<Message> LoadMessages(object data, LoadContext? context)
    {
        var result = new List<Message>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is IEnumerable<object>)
                {
                    throw new ArgumentException(
                        $"Invalid 'messages' format: key '{kvp.Key}' has an array value. " +
                        $"'messages' must be a flat list of objects or a name-keyed dict — " +
                        "not a nested {" + kvp.Key + ": [...]} structure.");
                }
                var itemDict = kvp.Value.GetDictionary();
                if (itemDict.Count > 0)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(Message.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar, use it as the primary property
                    var newDict = new Dictionary<string, object?>
                    {
                        ["name"] = kvp.Key,
                        ["role"] = kvp.Value
                    };
                    result.Add(Message.Load(newDict, context));
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                var itemDict = item.GetDictionary(Message.ShorthandProperty);
                if (itemDict.Count > 0)
                {
                    result.Add(Message.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the MessagesUpdatedPayload instance to a dictionary.
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


        result["messages"] = SaveMessages(obj.Messages, context);


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Save a list of Message to object or array format.
    /// </summary>
    public static object SaveMessages(IList<Message> items, SaveContext? context)
    {
        context ??= new SaveContext();

        // This collection type does not have a 'name' property, only array format is supported
        return items.Select(item => item.Save(context)).ToList();

    }


    /// <summary>
    /// Convert the MessagesUpdatedPayload instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the MessagesUpdatedPayload instance to a JSON string.
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
    /// Load a MessagesUpdatedPayload instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded MessagesUpdatedPayload instance.</returns>
    public static MessagesUpdatedPayload FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a MessagesUpdatedPayload instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded MessagesUpdatedPayload instance.</returns>
    public static MessagesUpdatedPayload FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
