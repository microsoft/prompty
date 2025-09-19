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
public class AzureContainerRegistry : Registry
{
    /// <summary>
    /// Initializes a new instance of <see cref="AzureContainerRegistry"/>.
    /// </summary>
    public AzureContainerRegistry()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "acr";
        
    /// <summary>
    /// 
    /// </summary>
    public string Subscription { get; set; } = string.Empty;
        
    /// <summary>
    /// 
    /// </summary>
    public string ResourceGroup { get; set; } = string.Empty;
        
    /// <summary>
    /// 
    /// </summary>
    public string RegistryName { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="AzureContainerRegistry"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new AzureContainerRegistry Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new AzureContainerRegistry();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("subscription", out var subscriptionValue))
        {
            instance.Subscription = subscriptionValue as string ?? throw new ArgumentException("Properties must contain a property named: subscription", nameof(props));
        }
        if (data.TryGetValue("resource_group", out var resource_groupValue))
        {
            instance.ResourceGroup = resource_groupValue as string ?? throw new ArgumentException("Properties must contain a property named: resource_group", nameof(props));
        }
        if (data.TryGetValue("registry_name", out var registry_nameValue))
        {
            instance.RegistryName = registry_nameValue as string ?? throw new ArgumentException("Properties must contain a property named: registry_name", nameof(props));
        }
        return instance;
    }
    
    
}
