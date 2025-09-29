// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json.Serialization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.Serialization;
using YamlDotNet.RepresentationModel;

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
[JsonConverter(typeof(PromptyBaseJsonConverter))]
public abstract class PromptyBase : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyBase"/>.
    /// </summary>
#pragma warning disable CS8618
    protected PromptyBase()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Kind represented by the document
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

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


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type PromptyBase");
            }

            // handle polymorphic types
            if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
            {
                var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
                switch (discriminatorValue)
                {
                    case "prompt":
                        var promptPromptyBase = nestedObjectDeserializer(typeof(Prompty)) as Prompty;
                        if (promptPromptyBase == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type Prompty");
                        }
                        return;
                    case "manifest":
                        var manifestPromptyBase = nestedObjectDeserializer(typeof(PromptyManifest)) as PromptyManifest;
                        if (manifestPromptyBase == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type PromptyManifest");
                        }
                        return;
                    case "container":
                        var containerPromptyBase = nestedObjectDeserializer(typeof(PromptyContainer)) as PromptyContainer;
                        if (containerPromptyBase == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type PromptyContainer");
                        }
                        return;
                    default:
                        throw new YamlException($"Unknown type discriminator '' when parsing PromptyBase");
                }
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing PromptyBase: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Id != null)
        {
            emitter.Emit(new Scalar("id"));
            nestedObjectSerializer(Id);
        }


        if (Version != null)
        {
            emitter.Emit(new Scalar("version"));
            nestedObjectSerializer(Version);
        }


        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        if (Description != null)
        {
            emitter.Emit(new Scalar("description"));
            nestedObjectSerializer(Description);
        }


        if (Metadata != null)
        {
            emitter.Emit(new Scalar("metadata"));
            nestedObjectSerializer(Metadata);
        }


        if (Inputs != null)
        {
            emitter.Emit(new Scalar("inputs"));
            nestedObjectSerializer(Inputs);
        }


        if (Outputs != null)
        {
            emitter.Emit(new Scalar("outputs"));
            nestedObjectSerializer(Outputs);
        }


        if (Tools != null)
        {
            emitter.Emit(new Scalar("tools"));
            nestedObjectSerializer(Tools);
        }


        if (Template != null)
        {
            emitter.Emit(new Scalar("template"));
            nestedObjectSerializer(Template);
        }


        if (Instructions != null)
        {
            emitter.Emit(new Scalar("instructions"));
            nestedObjectSerializer(Instructions);
        }


        if (AdditionalInstructions != null)
        {
            emitter.Emit(new Scalar("additionalInstructions"));
            nestedObjectSerializer(AdditionalInstructions);
        }

    }
}
