// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Configuration options for the Bing search tool.
/// </summary>
public class BingSearchConfiguration
{
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchConfiguration"/>.
    /// </summary>
    public BingSearchConfiguration()
    {
    }
        
    /// <summary>
    /// Connection id for grounding with bing search
    /// </summary>
    public string ConnectionId { get; set; } = string.Empty;
        
    /// <summary>
    /// The instance name of the Bing search tool, used to identify the specific instance in the system
    /// </summary>
    public string InstanceName { get; set; } = string.Empty;
        
    /// <summary>
    /// The market where the results come from.
    /// </summary>
    public string? Market { get; set; }
        
    /// <summary>
    /// The language to use for user interface strings when calling Bing API.
    /// </summary>
    public string? SetLang { get; set; }
        
    /// <summary>
    /// The number of search results to return in the bing api response
    /// </summary>
    public int? Count { get; set; }
        
    /// <summary>
    /// Filter search results by a specific time range. Accepted values: https://learn.microsoft.com/bing/search-apis/bing-web-search/reference/query-parameters
    /// </summary>
    public string? Freshness { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchConfiguration"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static BingSearchConfiguration Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new BingSearchConfiguration();
        
        if (data.TryGetValue("connectionId", out var connectionIdValue))
        {
            instance.ConnectionId = connectionIdValue as string ?? throw new ArgumentException("Properties must contain a property named: connectionId", nameof(props));
        }
        if (data.TryGetValue("instanceName", out var instanceNameValue))
        {
            instance.InstanceName = instanceNameValue as string ?? throw new ArgumentException("Properties must contain a property named: instanceName", nameof(props));
        }
        if (data.TryGetValue("market", out var marketValue))
        {
            instance.Market = marketValue as string;
        }
        if (data.TryGetValue("setLang", out var setLangValue))
        {
            instance.SetLang = setLangValue as string;
        }
        if (data.TryGetValue("count", out var countValue))
        {
            instance.Count = (int)countValue;
        }
        if (data.TryGetValue("freshness", out var freshnessValue))
        {
            instance.Freshness = freshnessValue as string;
        }
        return instance;
    }
    
    
}
