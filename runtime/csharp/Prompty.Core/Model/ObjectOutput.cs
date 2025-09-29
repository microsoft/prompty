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
/// Represents an object output property.
/// This extends the base Output model to represent a structured object.
/// </summary>
[JsonConverter(typeof(ObjectOutputJsonConverter))]
public class ObjectOutput : Output, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectOutput"/>.
    /// </summary>
#pragma warning disable CS8618
    public ObjectOutput()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";

    /// <summary>
    /// The properties contained in the object
    /// </summary>
    public IList<Output> Properties { get; set; } = [];


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type ObjectOutput");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing ObjectOutput: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("properties"));
        nestedObjectSerializer(Properties);
    }
}
