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
public class GenericConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericConnection"/>.
    /// </summary>
    public GenericConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// Additional options for the connection
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="GenericConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new GenericConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new GenericConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object>;
        }
        return instance;
    }
    
    
}
