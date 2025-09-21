// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a single input property for a prompt.
/// * This model defines the structure of input properties that can be used in prompts,
/// including their type, description, whether they are required, and other attributes.
/// * It allows for the definition of dynamic inputs that can be filled with data
/// and processed to generate prompts for AI models.
/// </summary>
public class Input
{
    /// <summary>
    /// Initializes a new instance of <see cref="Input"/>.
    /// </summary>
    public Input()
    {
    }
        
    /// <summary>
    /// Name of the input property
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The data type of the input property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// A short description of the input property
    /// </summary>
    public string? Description { get; set; }
        
    /// <summary>
    /// Whether the input property is required
    /// </summary>
    public bool? Required { get; set; }
        
    /// <summary>
    /// Whether the input property can emit structural text when parsing output
    /// </summary>
    public bool? Strict { get; set; }
        
    /// <summary>
    /// The default value of the input - this represents the default value if none is provided
    /// </summary>
    public object? Default { get; set; }
        
    /// <summary>
    /// A sample value of the input for examples and tooling
    /// </summary>
    public object? Sample { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Input"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Input Load(object props)
    {
        IDictionary<string, object> data;
        if (props is bool boolValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", "boolean"}, {"sample", boolValue}
            };
        }
        else if (props is float floatValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", "number"}, {"sample", floatValue}
            };
        }
        else if (props is int intValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", "number"}, {"sample", intValue}
            };
        }
        else if (props is string stringValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", "string"}, {"sample", stringValue}
            };
        }
        else
        {
            data = props.ToParamDictionary();
        }
        
        // load polymorphic Input instance
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
        if (data.TryGetValue("required", out var requiredValue))
        {
            instance.Required = (bool)requiredValue;
        }
        if (data.TryGetValue("strict", out var strictValue))
        {
            instance.Strict = (bool)strictValue;
        }
        if (data.TryGetValue("default", out var defaultValue))
        {
            instance.Default = defaultValue as object;
        }
        if (data.TryGetValue("sample", out var sampleValue))
        {
            instance.Sample = sampleValue as object;
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Input"/> based on the "kind" property.
    /// </summary>
    internal static Input LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Input instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "array")
            {
                return ArrayInput.Load(props);
            }
            else if (discriminator_value == "object")
            {
                return ObjectInput.Load(props);
            }
            else
            {
                //create new instance (stop recursion)
                return new Input();
            }
        }
        else
        {
            throw new ArgumentException("Missing Input discriminator property: 'kind'");
        }
    }
    
}
