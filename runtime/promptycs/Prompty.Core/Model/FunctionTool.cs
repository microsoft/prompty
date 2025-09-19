// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a local function tool.
/// </summary>
public class FunctionTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="FunctionTool"/>.
    /// </summary>
    public FunctionTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for function tools
    /// </summary>
    public override string Kind { get; set; } = "function";
        
    /// <summary>
    /// Parameters accepted by the function tool
    /// </summary>
    public IList<Parameter> Parameters { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="FunctionTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FunctionTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FunctionTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("parameters", out var parametersValue))
        {
            instance.Parameters = LoadParameters(parametersValue);
        }
        return instance;
    }
    
    internal static IList<Parameter> LoadParameters(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Parameter.Load(item))];
    }
    
    
}
