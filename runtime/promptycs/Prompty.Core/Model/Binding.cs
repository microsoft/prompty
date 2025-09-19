// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a binding between an input property and a tool parameter.
/// </summary>
public class Binding
{
    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
    public Binding()
    {
    }
        
    /// <summary>
    /// Name of the binding
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The input property that will be bound to the tool parameter argument
    /// </summary>
    public string Input { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Binding Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Binding();
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("input", out var inputValue))
        {
            instance.Input = inputValue as string ?? throw new ArgumentException("Properties must contain a property named: input", nameof(props));
        }
        return instance;
    }
    
    
}
