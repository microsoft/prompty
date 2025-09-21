// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a tool that can be used in prompts.
/// </summary>
public abstract class Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="Tool"/>.
    /// </summary>
    protected Tool()
    {
    }
        
    /// <summary>
    /// Name of the tool. If a function tool, this is the function name, otherwise it is the type
    /// </summary>
    public virtual string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The kind identifier for the tool
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// A short description of the tool for metadata purposes
    /// </summary>
    public string? Description { get; set; }
        
    /// <summary>
    /// Tool argument bindings to input properties
    /// </summary>
    public IList<Binding>? Bindings { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Tool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Tool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Tool instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("description", out var descriptionValue))
        {
            instance.Description = descriptionValue as string;
        }
        if (data.TryGetValue("bindings", out var bindingsValue))
        {
            instance.Bindings = LoadBindings(bindingsValue);
        }
        return instance;
    }
    
    internal static IList<Binding> LoadBindings(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Binding.Load(item))];
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Tool"/> based on the "kind" property.
    /// </summary>
    internal static Tool LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Tool instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "function")
            {
                return FunctionTool.Load(props);
            }
            else if (discriminator_value == "bing_search")
            {
                return BingSearchTool.Load(props);
            }
            else if (discriminator_value == "file_search")
            {
                return FileSearchTool.Load(props);
            }
            else if (discriminator_value == "mcp")
            {
                return McpTool.Load(props);
            }
            else if (discriminator_value == "model")
            {
                return ModelTool.Load(props);
            }
            else
            {
                
                // load default instance
                return ServerTool.Load(props);
                
            }
        }
        else
        {
            throw new ArgumentException("Missing Tool discriminator property: 'kind'");
        }
    }
    
}
