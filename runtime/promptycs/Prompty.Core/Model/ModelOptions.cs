// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Options for configuring the behavior of the AI model.
/// `kind` is a required property here, but this section can accept additional via options.
/// </summary>
public class ModelOptions
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
    public ModelOptions()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public string Kind { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static ModelOptions Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ModelOptions();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        return instance;
    }
    
    
}
