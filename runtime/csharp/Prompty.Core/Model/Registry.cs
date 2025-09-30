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
/// Definition for a container image registry.
/// </summary>
[JsonConverter(typeof(RegistryJsonConverter))]
public abstract class Registry : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Registry"/>.
    /// </summary>
#pragma warning disable CS8618
    protected Registry()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind of container registry
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The connection configuration for accessing the container registry
    /// </summary>
    public Connection Connection { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type Registry");
        }

        // handle polymorphic types
        if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
        {
            var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
            switch (discriminatorValue)
            {
                case "acr":
                    var acrRegistry = nestedObjectDeserializer(typeof(AzureContainerRegistry)) as AzureContainerRegistry;
                    if (acrRegistry == null)
                    {
                        throw new YamlException("Failed to deserialize polymorphic type AzureContainerRegistry");
                    }
                    return;
                default:
                    return;

            }
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("connection"));
        nestedObjectSerializer(Connection);
    }
}
