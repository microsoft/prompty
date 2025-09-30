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
/// 
/// </summary>
[JsonConverter(typeof(FoundryConnectionJsonConverter))]
public class FoundryConnection : Connection, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public FoundryConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "foundry";

    /// <summary>
    /// The Foundry endpoint URL for the AI service
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>
    /// The Foundry connection name
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The Foundry project name
    /// </summary>
    public string Project { get; set; } = string.Empty;


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type FoundryConnection");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("type"));
        nestedObjectSerializer(Type);

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        emitter.Emit(new Scalar("project"));
        nestedObjectSerializer(Project);
    }
}
