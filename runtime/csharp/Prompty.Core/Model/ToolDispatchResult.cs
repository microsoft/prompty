// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// The result of dispatching a single tool call. Pairs the tool call
    /// 
    /// identifier with the tool's name and result for correlation in the
    /// 
    /// agent loop's message assembly.
    /// </summary>
public partial class ToolDispatchResult
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="ToolDispatchResult"/>.
    /// </summary>
#pragma warning disable CS8618
    public ToolDispatchResult()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The tool call ID from the LLM response, used to correlate results
    /// </summary>
    public string ToolCallId { get; set; } = string.Empty;

    /// <summary>
    /// The name of the tool that was called
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The result produced by the tool handler
    /// </summary>
    public ToolResult Result { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a ToolDispatchResult instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolDispatchResult instance.</returns>
    public static ToolDispatchResult Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new ToolDispatchResult();


        if (data.TryGetValue("toolCallId", out var toolCallIdValue) && toolCallIdValue is not null)
        {
            instance.ToolCallId = toolCallIdValue?.ToString()!;
        }

        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("result", out var resultValue) && resultValue is not null)
        {
            instance.Result = ToolResult.Load(resultValue.GetDictionary(ToolResult.ShorthandProperty), context);
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
    /// Save the ToolDispatchResult instance to a dictionary.
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


        result["toolCallId"] = obj.ToolCallId;


        result["name"] = obj.Name;


        result["result"] = obj.Result?.Save(context);


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the ToolDispatchResult instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the ToolDispatchResult instance to a JSON string.
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
    /// Load a ToolDispatchResult instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolDispatchResult instance.</returns>
    public static ToolDispatchResult FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a ToolDispatchResult instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded ToolDispatchResult instance.</returns>
    public static ToolDispatchResult FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
