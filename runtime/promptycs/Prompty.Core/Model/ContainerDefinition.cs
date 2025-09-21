// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for a containerized AI agent.
/// </summary>
public class ContainerDefinition
{
    /// <summary>
    /// Initializes a new instance of <see cref="ContainerDefinition"/>.
    /// </summary>
    public ContainerDefinition()
    {
    }
        
    /// <summary>
    /// The container image name
    /// </summary>
    public string Image { get; set; } = string.Empty;
        
    /// <summary>
    /// The container image tag (defaults to 'latest' if not specified)
    /// </summary>
    public string? Tag { get; set; }
        
    /// <summary>
    /// Container image registry definition
    /// </summary>
    public Registry Registry { get; set; }
        
    /// <summary>
    /// Instance scaling configuration
    /// </summary>
    public Scale Scale { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="ContainerDefinition"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static ContainerDefinition Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ContainerDefinition();
        
        if (data.TryGetValue("image", out var imageValue))
        {
            instance.Image = imageValue as string ?? throw new ArgumentException("Properties must contain a property named: image", nameof(props));
        }
        if (data.TryGetValue("tag", out var tagValue))
        {
            instance.Tag = tagValue as string;
        }
        if (data.TryGetValue("registry", out var registryValue))
        {
            instance.Registry = Registry.Load(registryValue.ToParamDictionary());
        }
        if (data.TryGetValue("scale", out var scaleValue))
        {
            instance.Scale = Scale.Load(scaleValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
