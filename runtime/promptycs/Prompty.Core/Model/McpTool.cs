// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The MCP Server tool.
/// </summary>
public class McpTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
    public McpTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for MCP tools
    /// </summary>
    public override string Kind { get; set; } = "mcp";
        
    /// <summary>
    /// The connection configuration for the MCP tool
    /// </summary>
    public Connection Connection { get; set; } = new Connection();
        
    /// <summary>
    /// The name of the MCP tool
    /// </summary>
    public override string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The URL of the MCP server
    /// </summary>
    public string Url { get; set; } = string.Empty;
        
    /// <summary>
    /// List of allowed operations or resources for the MCP tool
    /// </summary>
    public IList<string> Allowed { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new McpTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new McpTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("url", out var urlValue))
        {
            instance.Url = urlValue as string ?? throw new ArgumentException("Properties must contain a property named: url", nameof(props));
        }
        if (data.TryGetValue("allowed", out var allowedValue))
        {
            instance.Allowed = allowedValue as IList<string> ?? throw new ArgumentException("Properties must contain a property named: allowed", nameof(props));
        }
        return instance;
    }
    
    
}
