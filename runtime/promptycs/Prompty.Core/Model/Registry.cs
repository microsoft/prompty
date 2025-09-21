// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for a container image registry.
/// </summary>
public abstract class Registry
{
    /// <summary>
    /// Initializes a new instance of <see cref="Registry"/>.
    /// </summary>
    protected Registry()
    {
    }
        
    /// <summary>
    /// The kind of container registry
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// The connection configuration for accessing the container registry
    /// </summary>
    public Connection Connection { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Registry"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Registry Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Registry instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Registry"/> based on the "kind" property.
    /// </summary>
    internal static Registry LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Registry instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "acr")
            {
                return AzureContainerRegistry.Load(props);
            }
            else
            {
                
                // load default instance
                return GenericRegistry.Load(props);
                
            }
        }
        else
        {
            throw new ArgumentException("Missing Registry discriminator property: 'kind'");
        }
    }
    
}
