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
/// Generic connection configuration for AI services.
/// </summary>
[JsonConverter(typeof(GenericConnectionJsonConverter))]
public class GenericConnection : Connection, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public GenericConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Additional options for the connection
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type GenericConnection");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Options != null)
        {
            emitter.Emit(new Scalar("options"));
            nestedObjectSerializer(Options);
        }

    }
}
