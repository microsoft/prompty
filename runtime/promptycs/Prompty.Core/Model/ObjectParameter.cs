// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an object parameter for a tool.
/// </summary>
public class ObjectParameter : Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectParameter"/>.
    /// </summary>
    public ObjectParameter()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";
        
    /// <summary>
    /// The properties of the object parameter
    /// </summary>
    public IList<Parameter> Properties { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="ObjectParameter"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ObjectParameter Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ObjectParameter();
        
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
    
    internal static IList<Parameter> LoadProperties(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Parameter.Load(item))];
    }
    
    
}
