// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using API keys.
/// </summary>
public class KeyConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="KeyConnection"/>.
    /// </summary>
    public KeyConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "key";
        
    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;
        
    /// <summary>
    /// The API key for authenticating with the AI service
    /// </summary>
    public string Key { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="KeyConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new KeyConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new KeyConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("endpoint", out var endpointValue))
        {
            instance.Endpoint = endpointValue as string ?? throw new ArgumentException("Properties must contain a property named: endpoint", nameof(props));
        }
        if (data.TryGetValue("key", out var keyValue))
        {
            instance.Key = keyValue as string ?? throw new ArgumentException("Properties must contain a property named: key", nameof(props));
        }
        return instance;
    }
    
    
}
