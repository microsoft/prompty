// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template parser definition
/// </summary>
public class Parser
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
    public Parser()
    {
    }
        
    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// Options for the parser
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Parser Load(object props)
    {
        IDictionary<string, object> data;
        if (props is string stringValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", stringValue}
            };
        }
        else
        {
            data = props.ToParamDictionary();
        }
        
        // create new instance
        var instance = new Parser();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object>;
        }
        return instance;
    }
    
    
}
