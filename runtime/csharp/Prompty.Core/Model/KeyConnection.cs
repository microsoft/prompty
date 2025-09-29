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
/// Connection configuration for AI services using API keys.
/// </summary>
[JsonConverter(typeof(KeyConnectionJsonConverter))]
public class KeyConnection : Connection, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="KeyConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public KeyConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "key";

    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The API key for authenticating with the AI service
    /// </summary>
    public string Key { get; set; } = string.Empty;


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type KeyConnection");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing KeyConnection: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("endpoint"));
        nestedObjectSerializer(Endpoint);

        emitter.Emit(new Scalar("key"));
        nestedObjectSerializer(Key);
    }
}
