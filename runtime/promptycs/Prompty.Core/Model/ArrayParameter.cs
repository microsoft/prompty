// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an array parameter for a tool.
/// </summary>
public class ArrayParameter : Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayParameter"/>.
    /// </summary>
    public ArrayParameter()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";
        
    /// <summary>
    /// The kind of items contained in the array
    /// </summary>
    public Parameter Items { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="ArrayParameter"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ArrayParameter Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ArrayParameter();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("items", out var itemsValue))
        {
            instance.Items = Parameter.Load(itemsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
