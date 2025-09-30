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
/// Represents an array parameter for a tool.
/// </summary>
[JsonConverter(typeof(ArrayParameterJsonConverter))]
public class ArrayParameter : Parameter, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayParameter"/>.
    /// </summary>
#pragma warning disable CS8618
    public ArrayParameter()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";

    /// <summary>
    /// The kind of items contained in the array
    /// </summary>
    public Parameter Items { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type ArrayParameter");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("items"));
        nestedObjectSerializer(Items);
    }
}
