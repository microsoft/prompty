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
/// Configuration for scaling container instances.
/// </summary>
[JsonConverter(typeof(ScaleJsonConverter))]
public class Scale : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Scale"/>.
    /// </summary>
#pragma warning disable CS8618
    public Scale()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Minimum number of container instances to run
    /// </summary>
    public int? MinReplicas { get; set; }

    /// <summary>
    /// Maximum number of container instances to run
    /// </summary>
    public int? MaxReplicas { get; set; }

    /// <summary>
    /// CPU allocation per instance (in cores)
    /// </summary>
    public float Cpu { get; set; }

    /// <summary>
    /// Memory allocation per instance (in GB)
    /// </summary>
    public float Memory { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type Scale");
        }

    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        if (MinReplicas != null)
        {
            emitter.Emit(new Scalar("minReplicas"));
            nestedObjectSerializer(MinReplicas);
        }


        if (MaxReplicas != null)
        {
            emitter.Emit(new Scalar("maxReplicas"));
            nestedObjectSerializer(MaxReplicas);
        }


        emitter.Emit(new Scalar("cpu"));
        nestedObjectSerializer(Cpu);

        emitter.Emit(new Scalar("memory"));
        nestedObjectSerializer(Memory);
    }
}
