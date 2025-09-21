// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
/// It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
/// The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
/// available tools, and template configurations for prompt rendering.
/// 
/// These can be written in a markdown format or in a pure YAML format.
/// </summary>
public class Prompty
{
    /// <summary>
    /// Initializes a new instance of <see cref="Prompty"/>.
    /// </summary>
    public Prompty()
    {
    }
        
    /// <summary>
    /// Kind represented by the document
    /// </summary>
    public virtual string Kind { get; set; } = "prompt";
        
    /// <summary>
    /// Unique identifier for the document
    /// </summary>
    public string? Id { get; set; }
        
    /// <summary>
    /// Document version
    /// </summary>
    public string? Version { get; set; }
        
    /// <summary>
    /// Human-readable name of the agent
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// Description of the agent's capabilities and purpose
    /// </summary>
    public string? Description { get; set; }
        
    /// <summary>
    /// Additional metadata including authors, tags, and other arbitrary properties
    /// </summary>
    public IDictionary<string, object>? Metadata { get; set; }
        
    /// <summary>
    /// Model configuration used for execution
    /// </summary>
    public Model Model { get; set; }
        
    /// <summary>
    /// Input parameters that participate in template rendering
    /// </summary>
    public IList<Input>? Inputs { get; set; }
        
    /// <summary>
    /// Expected output format and structure from the agent
    /// </summary>
    public IList<Output>? Outputs { get; set; }
        
    /// <summary>
    /// Tools available to the agent for extended functionality
    /// </summary>
    public IList<Tool>? Tools { get; set; }
        
    /// <summary>
    /// Template configuration for prompt rendering
    /// </summary>
    public Template? Template { get; set; }
        
    /// <summary>
    /// Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)
    /// </summary>
    public string? Instructions { get; set; }
        
    /// <summary>
    /// Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)
    /// </summary>
    public string? AdditionalInstructions { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Prompty"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Prompty Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Prompty instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("id", out var idValue))
        {
            instance.Id = idValue as string;
        }
        if (data.TryGetValue("version", out var versionValue))
        {
            instance.Version = versionValue as string;
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("description", out var descriptionValue))
        {
            instance.Description = descriptionValue as string;
        }
        if (data.TryGetValue("metadata", out var metadataValue))
        {
            instance.Metadata = metadataValue as IDictionary<string, object>;
        }
        if (data.TryGetValue("model", out var modelValue))
        {
            instance.Model = Model.Load(modelValue.ToParamDictionary());
        }
        if (data.TryGetValue("inputs", out var inputsValue))
        {
            instance.Inputs = LoadInputs(inputsValue);
        }
        if (data.TryGetValue("outputs", out var outputsValue))
        {
            instance.Outputs = LoadOutputs(outputsValue);
        }
        if (data.TryGetValue("tools", out var toolsValue))
        {
            instance.Tools = LoadTools(toolsValue);
        }
        if (data.TryGetValue("template", out var templateValue))
        {
            instance.Template = Template.Load(templateValue.ToParamDictionary());
        }
        if (data.TryGetValue("instructions", out var instructionsValue))
        {
            instance.Instructions = instructionsValue as string;
        }
        if (data.TryGetValue("additionalInstructions", out var additionalInstructionsValue))
        {
            instance.AdditionalInstructions = additionalInstructionsValue as string;
        }
        return instance;
    }
    
    internal static IList<Input> LoadInputs(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Input.Load(item))];
    }
    
    internal static IList<Output> LoadOutputs(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Output.Load(item))];
    }
    
    internal static IList<Tool> LoadTools(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Tool.Load(item))];
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Prompty"/> based on the "kind" property.
    /// </summary>
    internal static Prompty LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Prompty instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "container")
            {
                return PromptyContainer.Load(props);
            }
            else
            {
                //create new instance (stop recursion)
                return new Prompty();
            }
        }
        else
        {
            throw new ArgumentException("Missing Prompty discriminator property: 'kind'");
        }
    }
    
}
