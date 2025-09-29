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
/// The following represents a containerized agent that can be deployed and hosted.
/// It includes details about the container image, registry information, and environment variables.
/// This model allows for the definition of agents that can run in isolated environments,
/// making them suitable for deployment in various cloud or on-premises scenarios.
/// 
/// The containerized agent can communicate using specified protocols and can be scaled
/// based on the provided configuration.
/// </summary>
[JsonConverter(typeof(PromptyContainerJsonConverter))]
public class PromptyContainer : Prompty, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
#pragma warning disable CS8618
    public PromptyContainer()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Type of agent, e.g., 'container'
    /// </summary>
    public override string Kind { get; set; } = "container";

    /// <summary>
    /// Protocol used by the containerized agent
    /// </summary>
    public string Protocol { get; set; } = "responses";

    /// <summary>
    /// Container definition including registry and scaling information
    /// </summary>
    public ContainerDefinition Container { get; set; }

    /// <summary>
    /// Environment variables to set in the hosted agent container.
    /// </summary>
    public IList<EnvironmentVariable>? EnvironmentVariables { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type PromptyContainer");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing PromptyContainer: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("protocol"));
        nestedObjectSerializer(Protocol);

        emitter.Emit(new Scalar("container"));
        nestedObjectSerializer(Container);

        if (EnvironmentVariables != null)
        {
            emitter.Emit(new Scalar("environmentVariables"));
            nestedObjectSerializer(EnvironmentVariables);
        }

    }
}
