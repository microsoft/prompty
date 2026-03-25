// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for Microsoft Foundry projects.
/// Provides project-scoped access to models, tools, and services
/// via Entra ID (DefaultAzureCredential) authentication.
/// </summary>
public class FoundryConnection : Connection
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public FoundryConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The connection kind for Foundry project access
    /// </summary>
    public override string Kind { get; set; } = "foundry";

    /// <summary>
    /// The Foundry project endpoint URL
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The named connection within the Foundry project
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// The connection type within the Foundry project (e.g., 'model', 'index', 'storage')
    /// </summary>
    public string? ConnectionType { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a FoundryConnection instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FoundryConnection instance.</returns>
    public new static FoundryConnection Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new FoundryConnection();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("endpoint", out var endpointValue) && endpointValue is not null)
        {
            instance.Endpoint = endpointValue?.ToString()!;
        }

        if (data.TryGetValue("name", out var nameValue) && nameValue is not null)
        {
            instance.Name = nameValue?.ToString()!;
        }

        if (data.TryGetValue("connectionType", out var connectionTypeValue) && connectionTypeValue is not null)
        {
            instance.ConnectionType = connectionTypeValue?.ToString()!;
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
    /// Save the FoundryConnection instance to a dictionary.
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

        if (obj.Endpoint is not null)
        {
            result["endpoint"] = obj.Endpoint;
        }

        if (obj.Name is not null)
        {
            result["name"] = obj.Name;
        }

        if (obj.ConnectionType is not null)
        {
            result["connectionType"] = obj.ConnectionType;
        }


        return result;
    }


    /// <summary>
    /// Convert the FoundryConnection instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the FoundryConnection instance to a JSON string.
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
    /// Load a FoundryConnection instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FoundryConnection instance.</returns>
    public new static FoundryConnection FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a FoundryConnection instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded FoundryConnection instance.</returns>
    public new static FoundryConnection FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
