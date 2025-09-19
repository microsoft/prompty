// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// 
/// </summary>
public class FoundryConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
    public FoundryConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "foundry";
        
    /// <summary>
    /// The Foundry endpoint URL for the AI service
    /// </summary>
    public string Type { get; set; } = string.Empty;
        
    /// <summary>
    /// The Foundry connection name
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The Foundry project name
    /// </summary>
    public string Project { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FoundryConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FoundryConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("type", out var typeValue))
        {
            instance.Type = typeValue as string ?? throw new ArgumentException("Properties must contain a property named: type", nameof(props));
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("project", out var projectValue))
        {
            instance.Project = projectValue as string ?? throw new ArgumentException("Properties must contain a property named: project", nameof(props));
        }
        return instance;
    }
    
    
}
