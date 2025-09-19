// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template format definition
/// </summary>
public class Format
{
    /// <summary>
    /// Initializes a new instance of <see cref="Format"/>.
    /// </summary>
    public Format()
    {
    }
        
    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// Whether the template can emit structural text for parsing output
    /// </summary>
    public bool? Strict { get; set; }
        
    /// <summary>
    /// Options for the template engine
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Format"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Format Load(object props)
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
        var instance = new Format();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("strict", out var strictValue))
        {
            instance.Strict = (bool)strictValue;
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object>;
        }
        return instance;
    }
    
    
}
