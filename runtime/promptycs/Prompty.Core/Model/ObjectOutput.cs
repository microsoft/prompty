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
public class ObjectOutput : Output
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectOutput"/>.
    /// </summary>
    public ObjectOutput()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";
        
    /// <summary>
    /// The properties contained in the object
    /// </summary>
    public IList<Output> Properties { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="ObjectOutput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ObjectOutput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ObjectOutput();
        
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
    
    internal static IList<Output> LoadProperties(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Output.Load(item))];
    }
    
    
}
