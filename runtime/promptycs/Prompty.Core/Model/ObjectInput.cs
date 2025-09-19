// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an object output property.
/// This extends the base Output model to represent a structured object.
/// </summary>
public class ObjectInput : Input
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectInput"/>.
    /// </summary>
    public ObjectInput()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";
        
    /// <summary>
    /// The properties contained in the object
    /// </summary>
    public IList<Input> Properties { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="ObjectInput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ObjectInput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ObjectInput();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("properties", out var propertiesValue))
        {
            instance.Properties = LoadProperties(propertiesValue);
        }
        return instance;
    }
    
    internal static IList<Input> LoadProperties(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Input.Load(item))];
    }
    
    
}
