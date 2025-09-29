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
/// Connection configuration for AI services using named connections.
/// </summary>
[JsonConverter(typeof(ReferenceConnectionJsonConverter))]
public class ReferenceConnection : Connection, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public ReferenceConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "reference";

    /// <summary>
    /// The name of the connection
    /// </summary>
    public string Name { get; set; } = string.Empty;


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type ReferenceConnection");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing ReferenceConnection: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);
    }
}
