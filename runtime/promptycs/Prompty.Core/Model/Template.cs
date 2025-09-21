// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template model for defining prompt templates.
/// 
/// This model specifies the rendering engine used for slot filling prompts,
/// the parser used to process the rendered template into API-compatible format,
/// and additional options for the template engine.
/// 
/// It allows for the creation of reusable templates that can be filled with dynamic data
/// and processed to generate prompts for AI models.
/// </summary>
public class Template
{
    /// <summary>
    /// Initializes a new instance of <see cref="Template"/>.
    /// </summary>
    public Template()
    {
    }
        
    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public Format Format { get; set; }
        
    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public Parser Parser { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Template"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Template Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Template();
        
        if (data.TryGetValue("format", out var formatValue))
        {
            instance.Format = Format.Load(formatValue.ToParamDictionary());
        }
        if (data.TryGetValue("parser", out var parserValue))
        {
            instance.Parser = Parser.Load(parserValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}
