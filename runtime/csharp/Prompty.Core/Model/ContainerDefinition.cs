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
/// Definition for a containerized AI agent.
/// </summary>
[JsonConverter(typeof(ContainerDefinitionJsonConverter))]
public class ContainerDefinition : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ContainerDefinition"/>.
    /// </summary>
#pragma warning disable CS8618
    public ContainerDefinition()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The container image name
    /// </summary>
    public string Image { get; set; } = string.Empty;

    /// <summary>
    /// The container image tag (defaults to 'latest' if not specified)
    /// </summary>
    public string? Tag { get; set; }

    /// <summary>
    /// Container image registry definition
    /// </summary>
    public Registry Registry { get; set; }

    /// <summary>
    /// Instance scaling configuration
    /// </summary>
    public Scale Scale { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type ContainerDefinition");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing ContainerDefinition: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("image"));
        nestedObjectSerializer(Image);

        if (Tag != null)
        {
            emitter.Emit(new Scalar("tag"));
            nestedObjectSerializer(Tag);
        }


        emitter.Emit(new Scalar("registry"));
        nestedObjectSerializer(Registry);

        emitter.Emit(new Scalar("scale"));
        nestedObjectSerializer(Scale);
    }
}
