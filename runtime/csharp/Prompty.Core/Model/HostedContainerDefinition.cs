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
/// Definition for a containerized AI agent hosted by the provider.
/// This includes the container registry information and scaling configuration.
/// </summary>
[JsonConverter(typeof(HostedContainerDefinitionJsonConverter))]
public class HostedContainerDefinition : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="HostedContainerDefinition"/>.
    /// </summary>
#pragma warning disable CS8618
    public HostedContainerDefinition()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Instance scaling configuration
    /// </summary>
    public Scale Scale { get; set; }

    /// <summary>
    /// Container context for building the container image
    /// </summary>
    public object Context { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type HostedContainerDefinition");
        }

    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("scale"));
        nestedObjectSerializer(Scale);

        emitter.Emit(new Scalar("context"));
        nestedObjectSerializer(Context);
    }
}
