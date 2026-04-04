// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// A tool that references another .prompty file to be invoked as a tool.
/// 
/// In `single` mode, the child prompty is executed with a single LLM call.
/// In `agentic` mode, the child prompty runs a full agent loop with its own tools.
/// </summary>
public class PromptyTool : Tool
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="PromptyTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public PromptyTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for prompty tools
    /// </summary>
    public override string Kind { get; set; } = "prompty";

    /// <summary>
    /// Path to the child .prompty file, relative to the parent
    /// </summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>
    /// Execution mode: 'single' for one LLM call, 'agentic' for full agent loop
    /// </summary>
    public string Mode { get; set; } = "single";


    #region Load Methods

    /// <summary>
    /// Load a PromptyTool instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PromptyTool instance.</returns>
    public new static PromptyTool Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new PromptyTool();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("path", out var pathValue) && pathValue is not null)
        {
            instance.Path = pathValue?.ToString()!;
        }

        if (data.TryGetValue("mode", out var modeValue) && modeValue is not null)
        {
            instance.Mode = modeValue?.ToString()!;
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
    /// Save the PromptyTool instance to a dictionary.
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

        if (obj.Path is not null)
        {
            result["path"] = obj.Path;
        }

        if (obj.Mode is not null)
        {
            result["mode"] = obj.Mode;
        }


        return result;
    }


    /// <summary>
    /// Convert the PromptyTool instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the PromptyTool instance to a JSON string.
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
    /// Load a PromptyTool instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PromptyTool instance.</returns>
    public new static PromptyTool FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a PromptyTool instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded PromptyTool instance.</returns>
    public new static PromptyTool FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
