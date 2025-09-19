// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Configuration for scaling container instances.
/// </summary>
public class Scale
{
    /// <summary>
    /// Initializes a new instance of <see cref="Scale"/>.
    /// </summary>
    public Scale()
    {
    }
        
    /// <summary>
    /// Minimum number of container instances to run
    /// </summary>
    public int? MinReplicas { get; set; }
        
    /// <summary>
    /// Maximum number of container instances to run
    /// </summary>
    public int? MaxReplicas { get; set; }
        
    /// <summary>
    /// CPU allocation per instance (in cores)
    /// </summary>
    public float Cpu { get; set; }
        
    /// <summary>
    /// Memory allocation per instance (in GB)
    /// </summary>
    public float Memory { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Scale"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Scale Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Scale();
        
        if (data.TryGetValue("minReplicas", out var minReplicasValue))
        {
            instance.MinReplicas = (int)minReplicasValue;
        }
        if (data.TryGetValue("maxReplicas", out var maxReplicasValue))
        {
            instance.MaxReplicas = (int)maxReplicasValue;
        }
        if (data.TryGetValue("cpu", out var cpuValue))
        {
            instance.Cpu = (float)cpuValue;
        }
        if (data.TryGetValue("memory", out var memoryValue))
        {
            instance.Memory = (float)memoryValue;
        }
        return instance;
    }
    
    
}
