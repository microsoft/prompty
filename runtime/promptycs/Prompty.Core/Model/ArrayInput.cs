// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an array output property.
/// This extends the base Output model to represent an array of items.
/// </summary>
public class ArrayInput : Input
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayInput"/>.
    /// </summary>
    public ArrayInput()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";
        
    /// <summary>
    /// The type of items contained in the array
    /// </summary>
    public Input Items { get; set; } = new Input();
    

    /// <summary>
    /// Initializes a new instance of <see cref="ArrayInput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ArrayInput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ArrayInput();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("items", out var itemsValue))
        {
            instance.Items = Input.Load(itemsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
