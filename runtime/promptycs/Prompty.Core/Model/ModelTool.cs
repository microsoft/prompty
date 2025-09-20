// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The MCP Server tool.
/// </summary>
public class ModelTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelTool"/>.
    /// </summary>
    public ModelTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for a model connection as a tool
    /// </summary>
    public override string Kind { get; set; } = "model";
        
    /// <summary>
    /// The connection configuration for the model tool
    /// </summary>
    public Model Model { get; set; } = new Model();
    

    /// <summary>
    /// Initializes a new instance of <see cref="ModelTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ModelTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ModelTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("model", out var modelValue))
        {
            instance.Model = Model.Load(modelValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
