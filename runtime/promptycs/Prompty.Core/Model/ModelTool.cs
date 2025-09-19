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
    /// The kind identifier for MCP tools
    /// </summary>
    public override string Kind { get; set; } = "model";
        
    /// <summary>
    /// The unique identifier of the model - can be used as the single property shorthand
    /// </summary>
    public string Id { get; set; } = string.Empty;
        
    /// <summary>
    /// The provider of the model (e.g., 'openai', 'azure', 'anthropic')
    /// </summary>
    public string? Provider { get; set; }
        
    /// <summary>
    /// The connection configuration for the model
    /// </summary>
    public Connection? Connection { get; set; }
        
    /// <summary>
    /// Additional options for the model
    /// </summary>
    public ModelOptions? Options { get; set; }
    

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
        if (data.TryGetValue("id", out var idValue))
        {
            instance.Id = idValue as string ?? throw new ArgumentException("Properties must contain a property named: id", nameof(props));
        }
        if (data.TryGetValue("provider", out var providerValue))
        {
            instance.Provider = providerValue as string;
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = ModelOptions.Load(optionsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
