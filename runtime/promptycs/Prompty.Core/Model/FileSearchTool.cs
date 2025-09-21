// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// A tool for searching files.
/// This tool allows an AI agent to search for files based on a query.
/// </summary>
public class FileSearchTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="FileSearchTool"/>.
    /// </summary>
    public FileSearchTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for file search tools
    /// </summary>
    public override string Kind { get; set; } = "file_search";
        
    /// <summary>
    /// The connection configuration for the file search tool
    /// </summary>
    public Connection Connection { get; set; }
        
    /// <summary>
    /// The maximum number of search results to return.
    /// </summary>
    public int? MaxNumResults { get; set; }
        
    /// <summary>
    /// File search ranker.
    /// </summary>
    public string Ranker { get; set; } = string.Empty;
        
    /// <summary>
    /// Ranker search threshold.
    /// </summary>
    public float ScoreThreshold { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="FileSearchTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FileSearchTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FileSearchTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("maxNumResults", out var maxNumResultsValue))
        {
            instance.MaxNumResults = (int)maxNumResultsValue;
        }
        if (data.TryGetValue("ranker", out var rankerValue))
        {
            instance.Ranker = rankerValue as string ?? throw new ArgumentException("Properties must contain a property named: ranker", nameof(props));
        }
        if (data.TryGetValue("scoreThreshold", out var scoreThresholdValue))
        {
            instance.ScoreThreshold = (float)scoreThresholdValue;
        }
        return instance;
    }
    
    
}
