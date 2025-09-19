// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a generic server tool that runs on a server
/// This tool kind is designed for operations that require server-side execution
/// It may include features such as authentication, data storage, and long-running processes
/// This tool kind is ideal for tasks that involve complex computations or access to secure resources
/// Server tools can be used to offload heavy processing from client applications
/// </summary>
public class ServerTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="ServerTool"/>.
    /// </summary>
    public ServerTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for server tools. This is a wildcard and can represent any server tool type not explicitly defined.
    /// </summary>
    public override string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// Connection configuration for the server tool
    /// </summary>
    public Connection Connection { get; set; } = new Connection();
        
    /// <summary>
    /// Configuration options for the server tool
    /// </summary>
    public IDictionary<string, object> Options { get; set; } = new Dictionary<string, object>();
    

    /// <summary>
    /// Initializes a new instance of <see cref="ServerTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ServerTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ServerTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object> ?? throw new ArgumentException("Properties must contain a property named: options", nameof(props));
        }
        return instance;
    }
    
    
}
