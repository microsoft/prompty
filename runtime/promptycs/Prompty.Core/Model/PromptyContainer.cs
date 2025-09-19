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
public class PromptyContainer : Prompty
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
    public PromptyContainer()
    {
    }
        
    /// <summary>
    /// Type of agent, e.g., 'prompt' or 'container'
    /// </summary>
    public override string Kind { get; set; } = "container";
        
    /// <summary>
    /// Protocol used by the containerized agent
    /// </summary>
    public string Protocol { get; set; } = string.Empty;
        
    /// <summary>
    /// Container definition including registry and scaling information
    /// </summary>
    public ContainerDefinition Container { get; set; } = new ContainerDefinition();
        
    /// <summary>
    /// Environment variables to set in the hosted agent container.
    /// </summary>
    public IList<EnvironmentVariable>? EnvironmentVariables { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new PromptyContainer Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new PromptyContainer();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("protocol", out var protocolValue))
        {
            instance.Protocol = protocolValue as string ?? throw new ArgumentException("Properties must contain a property named: protocol", nameof(props));
        }
        if (data.TryGetValue("container", out var containerValue))
        {
            instance.Container = ContainerDefinition.Load(containerValue.ToParamDictionary());
        }
        if (data.TryGetValue("environment_variables", out var environment_variablesValue))
        {
            instance.EnvironmentVariables = LoadEnvironmentVariables(environment_variablesValue);
        }
        return instance;
    }
    
    internal static IList<EnvironmentVariable> LoadEnvironmentVariables(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => EnvironmentVariable.Load(item))];
    }
    
    
}
