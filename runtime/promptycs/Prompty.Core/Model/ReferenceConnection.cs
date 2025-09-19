// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using named connections.
/// </summary>
public class ReferenceConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
    public ReferenceConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "reference";
        
    /// <summary>
    /// The name of the connection
    /// </summary>
    public string Name { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ReferenceConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ReferenceConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        return instance;
    }
    
    
}
