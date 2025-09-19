// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for an Azure Container Registry (ACR).
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
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = "acr";
        
    /// <summary>
    /// The Azure subscription ID for the ACR
    /// </summary>
    public string Subscription { get; set; } = string.Empty;
        
    /// <summary>
    /// The Azure resource group containing the ACR
    /// </summary>
    public string ResourceGroup { get; set; } = string.Empty;
        
    /// <summary>
    /// The name of the ACR
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
        if (data.TryGetValue("resourceGroup", out var resourceGroupValue))
        {
            instance.ResourceGroup = resourceGroupValue as string ?? throw new ArgumentException("Properties must contain a property named: resourceGroup", nameof(props));
        }
        if (data.TryGetValue("registryName", out var registryNameValue))
        {
            instance.RegistryName = registryNameValue as string ?? throw new ArgumentException("Properties must contain a property named: registryName", nameof(props));
        }
        return instance;
    }
    
    
}
