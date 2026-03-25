// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// The MCP Server tool.
/// </summary>
public class McpTool : Tool
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public McpTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for MCP tools
    /// </summary>
    public override string Kind { get; set; } = "mcp";

    /// <summary>
    /// The connection configuration for the MCP tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The server name of the MCP tool
    /// </summary>
    public string ServerName { get; set; } = string.Empty;

    /// <summary>
    /// The description of the MCP tool
    /// </summary>
    public string? ServerDescription { get; set; }

    /// <summary>
    /// The approval mode for the MCP tool
    /// </summary>
    public McpApprovalMode ApprovalMode { get; set; }

    /// <summary>
    /// List of allowed operations or resources for the MCP tool
    /// </summary>
    public IList<string>? AllowedTools { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a McpTool instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpTool instance.</returns>
    public new static McpTool Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new McpTool();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("connection", out var connectionValue) && connectionValue is not null)
        {
            instance.Connection = Connection.Load(connectionValue.GetDictionary(), context);
        }

        if (data.TryGetValue("serverName", out var serverNameValue) && serverNameValue is not null)
        {
            instance.ServerName = serverNameValue?.ToString()!;
        }

        if (data.TryGetValue("serverDescription", out var serverDescriptionValue) && serverDescriptionValue is not null)
        {
            instance.ServerDescription = serverDescriptionValue?.ToString()!;
        }

        if (data.TryGetValue("approvalMode", out var approvalModeValue) && approvalModeValue is not null)
        {
            instance.ApprovalMode = McpApprovalMode.Load(approvalModeValue.GetDictionary(), context);
        }

        if (data.TryGetValue("allowedTools", out var allowedToolsValue) && allowedToolsValue is not null)
        {
            instance.AllowedTools = (allowedToolsValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
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
    /// Save the McpTool instance to a dictionary.
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

        if (obj.ServerName is not null)
        {
            result["serverName"] = obj.ServerName;
        }

        if (obj.ServerDescription is not null)
        {
            result["serverDescription"] = obj.ServerDescription;
        }

        if (obj.ApprovalMode is not null)
        {
            result["approvalMode"] = obj.ApprovalMode?.Save(context);
        }

        if (obj.AllowedTools is not null)
        {
            result["allowedTools"] = obj.AllowedTools;
        }


        return result;
    }


    /// <summary>
    /// Convert the McpTool instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the McpTool instance to a JSON string.
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
    /// Load a McpTool instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpTool instance.</returns>
    public new static McpTool FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a McpTool instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpTool instance.</returns>
    public new static McpTool FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
