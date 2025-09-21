// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The Bing search tool.
/// </summary>
public class BingSearchTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchTool"/>.
    /// </summary>
    public BingSearchTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for Bing search tools
    /// </summary>
    public override string Kind { get; set; } = "bing_search";
        
    /// <summary>
    /// The connection configuration for the Bing search tool
    /// </summary>
    public Connection Connection { get; set; }
        
    /// <summary>
    /// The configuration options for the Bing search tool
    /// </summary>
    public IList<BingSearchConfiguration> Configurations { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new BingSearchTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new BingSearchTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("configurations", out var configurationsValue))
        {
            instance.Configurations = LoadConfigurations(configurationsValue);
        }
        return instance;
    }
    
    internal static IList<BingSearchConfiguration> LoadConfigurations(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => BingSearchConfiguration.Load(item))];
    }
    
    
}
