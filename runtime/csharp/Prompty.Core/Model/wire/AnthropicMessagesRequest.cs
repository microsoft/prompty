// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The full request body for the Anthropic Messages API (§7.5).
/// </summary>
public partial class AnthropicMessagesRequest
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="AnthropicMessagesRequest"/>.
    /// </summary>
#pragma warning disable CS8618
    public AnthropicMessagesRequest()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The model identifier
    /// </summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>
    /// The non-system messages to send
    /// </summary>
    public IList<AnthropicWireMessage> Messages { get; set; } = [];

    /// <summary>
    /// Maximum number of tokens to generate (required by Anthropic)
    /// </summary>
    public int MaxTokens { get; set; }

    /// <summary>
    /// System prompt text (extracted from system-role messages)
    /// </summary>
    public string? System { get; set; }

    /// <summary>
    /// Sampling temperature
    /// </summary>
    public float? Temperature { get; set; }

    /// <summary>
    /// Top-P sampling value
    /// </summary>
    public float? TopP { get; set; }

    /// <summary>
    /// Top-K sampling value
    /// </summary>
    public int? TopK { get; set; }

    /// <summary>
    /// Stop sequences to end generation
    /// </summary>
    public IList<string>? StopSequences { get; set; }

    /// <summary>
    /// Tool definitions available to the model
    /// </summary>
    public IList<AnthropicToolDefinition>? Tools { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a AnthropicMessagesRequest instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesRequest instance.</returns>
    public static AnthropicMessagesRequest Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new AnthropicMessagesRequest();


        if (data.TryGetValue("model", out var modelValue) && modelValue is not null)
        {
            instance.Model = modelValue?.ToString()!;
        }

        if (data.TryGetValue("messages", out var messagesValue) && messagesValue is not null)
        {
            instance.Messages = LoadMessages(messagesValue, context);
        }

        if (data.TryGetValue("max_tokens", out var max_tokensValue) && max_tokensValue is not null)
        {
            instance.MaxTokens = Convert.ToInt32(max_tokensValue);
        }

        if (data.TryGetValue("system", out var systemValue) && systemValue is not null)
        {
            instance.System = systemValue?.ToString()!;
        }

        if (data.TryGetValue("temperature", out var temperatureValue) && temperatureValue is not null)
        {
            instance.Temperature = Convert.ToSingle(temperatureValue);
        }

        if (data.TryGetValue("top_p", out var top_pValue) && top_pValue is not null)
        {
            instance.TopP = Convert.ToSingle(top_pValue);
        }

        if (data.TryGetValue("top_k", out var top_kValue) && top_kValue is not null)
        {
            instance.TopK = Convert.ToInt32(top_kValue);
        }

        if (data.TryGetValue("stop_sequences", out var stop_sequencesValue) && stop_sequencesValue is not null)
        {
            instance.StopSequences = (stop_sequencesValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
        }

        if (data.TryGetValue("tools", out var toolsValue) && toolsValue is not null)
        {
            instance.Tools = LoadTools(toolsValue, context);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    /// <summary>
    /// Load a list of AnthropicWireMessage from a dictionary or list.
    /// </summary>
    public static IList<AnthropicWireMessage> LoadMessages(object data, LoadContext? context)
    {
        var result = new List<AnthropicWireMessage>();

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
                    result.Add(AnthropicWireMessage.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar, use it as the primary property
                    var newDict = new Dictionary<string, object?>
                    {
                        ["name"] = kvp.Key,
                        ["role"] = kvp.Value
                    };
                    result.Add(AnthropicWireMessage.Load(newDict, context));
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                var itemDict = item.GetDictionary(AnthropicWireMessage.ShorthandProperty);
                if (itemDict.Count > 0)
                {
                    result.Add(AnthropicWireMessage.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    /// <summary>
    /// Load a list of AnthropicToolDefinition from a dictionary or list.
    /// </summary>
    public static IList<AnthropicToolDefinition> LoadTools(object data, LoadContext? context)
    {
        var result = new List<AnthropicToolDefinition>();

        if (data is Dictionary<string, object?> dict)
        {
            // Convert named dictionary to list
            foreach (var kvp in dict)
            {
                if (kvp.Value is IEnumerable<object>)
                {
                    throw new ArgumentException(
                        $"Invalid 'tools' format: key '{kvp.Key}' has an array value. " +
                        $"'tools' must be a flat list of objects or a name-keyed dict — " +
                        "not a nested {" + kvp.Key + ": [...]} structure.");
                }
                var itemDict = kvp.Value.GetDictionary();
                if (itemDict.Count > 0)
                {
                    // Value is an object, add name to it
                    itemDict["name"] = kvp.Key;
                    result.Add(AnthropicToolDefinition.Load(itemDict, context));
                }
                else
                {
                    // Value is a scalar, use it as the primary property
                    var newDict = new Dictionary<string, object?>
                    {
                        ["name"] = kvp.Key,
                        ["description"] = kvp.Value
                    };
                    result.Add(AnthropicToolDefinition.Load(newDict, context));
                }
            }
        }
        else if (data is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                var itemDict = item.GetDictionary(AnthropicToolDefinition.ShorthandProperty);
                if (itemDict.Count > 0)
                {
                    result.Add(AnthropicToolDefinition.Load(itemDict, context));
                }
            }
        }

        return result;
    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the AnthropicMessagesRequest instance to a dictionary.
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


        result["model"] = obj.Model;


        result["messages"] = SaveMessages(obj.Messages, context);


        result["max_tokens"] = obj.MaxTokens;


        if (obj.System is not null)
        {
            result["system"] = obj.System;
        }


        if (obj.Temperature is not null)
        {
            result["temperature"] = obj.Temperature;
        }


        if (obj.TopP is not null)
        {
            result["top_p"] = obj.TopP;
        }


        if (obj.TopK is not null)
        {
            result["top_k"] = obj.TopK;
        }


        if (obj.StopSequences is not null)
        {
            result["stop_sequences"] = obj.StopSequences;
        }


        if (obj.Tools is not null)
        {
            result["tools"] = SaveTools(obj.Tools, context);
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Save a list of AnthropicWireMessage to object or array format.
    /// </summary>
    public static object SaveMessages(IList<AnthropicWireMessage> items, SaveContext? context)
    {
        context ??= new SaveContext();

        // This collection type does not have a 'name' property, only array format is supported
        return items.Select(item => item.Save(context)).ToList();

    }


    /// <summary>
    /// Save a list of AnthropicToolDefinition to object or array format.
    /// </summary>
    public static object SaveTools(IList<AnthropicToolDefinition> items, SaveContext? context)
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
                if (context.UseShorthand && AnthropicToolDefinition.ShorthandProperty is string shorthandProp)
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
    /// Convert the AnthropicMessagesRequest instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the AnthropicMessagesRequest instance to a JSON string.
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
    /// Load a AnthropicMessagesRequest instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesRequest instance.</returns>
    public static AnthropicMessagesRequest FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a AnthropicMessagesRequest instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded AnthropicMessagesRequest instance.</returns>
    public static AnthropicMessagesRequest FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
