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
/// Represents the output properties of an AI agent.
/// Each output property can be a simple kind, an array, or an object.
/// </summary>
[JsonConverter(typeof(OutputJsonConverter))]
public class Output : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Output"/>.
    /// </summary>
#pragma warning disable CS8618
    public Output()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the output property
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data kind of the output property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the output property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the output property is required
    /// </summary>
    public bool? Required { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type Output");
        }

        // handle polymorphic types
        if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
        {
            var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
            switch (discriminatorValue)
            {
                case "array":
                    var arrayOutput = nestedObjectDeserializer(typeof(ArrayOutput)) as ArrayOutput;
                    if (arrayOutput == null)
                    {
                        throw new YamlException("Failed to deserialize polymorphic type ArrayOutput");
                    }
                    return;
                case "object":
                    var objectOutput = nestedObjectDeserializer(typeof(ObjectOutput)) as ObjectOutput;
                    if (objectOutput == null)
                    {
                        throw new YamlException("Failed to deserialize polymorphic type ObjectOutput");
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

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Description != null)
        {
            emitter.Emit(new Scalar("description"));
            nestedObjectSerializer(Description);
        }


        if (Required != null)
        {
            emitter.Emit(new Scalar("required"));
            nestedObjectSerializer(Required);
        }

    }
}
