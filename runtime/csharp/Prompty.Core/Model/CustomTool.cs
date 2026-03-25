// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Represents a generic server tool that runs on a server
/// This tool kind is designed for operations that require server-side execution
/// It may include features such as authentication, data storage, and long-running processes
/// This tool kind is ideal for tasks that involve complex computations or access to secure resources
/// Server tools can be used to offload heavy processing from client applications
/// </summary>
public class CustomTool : Tool
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="CustomTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public CustomTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for server tools. This is a wildcard and can represent any server tool type not explicitly defined.
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Connection configuration for the server tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// Configuration options for the server tool
    /// </summary>
    public IDictionary<string, object> Options { get; set; } = new Dictionary<string, object>();


    #region Load Methods

    /// <summary>
    /// Load a CustomTool instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CustomTool instance.</returns>
    public new static CustomTool Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new CustomTool();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("connection", out var connectionValue) && connectionValue is not null)
        {
            instance.Connection = Connection.Load(connectionValue.GetDictionary(), context);
        }

        if (data.TryGetValue("options", out var optionsValue) && optionsValue is not null)
        {
            instance.Options = optionsValue.GetDictionary()!;
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
    /// Save the CustomTool instance to a dictionary.
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

        if (obj.Connection is not null)
        {
            result["connection"] = obj.Connection?.Save(context);
        }

        if (obj.Options is not null)
        {
            result["options"] = obj.Options;
        }


        return result;
    }


    /// <summary>
    /// Convert the CustomTool instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the CustomTool instance to a JSON string.
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
    /// Load a CustomTool instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CustomTool instance.</returns>
    public new static CustomTool FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a CustomTool instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded CustomTool instance.</returns>
    public new static CustomTool FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
