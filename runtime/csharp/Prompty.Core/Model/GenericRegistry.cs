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
/// Definition for a generic container image registry.
/// </summary>
[JsonConverter(typeof(GenericRegistryJsonConverter))]
public class GenericRegistry : Registry, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericRegistry"/>.
    /// </summary>
#pragma warning disable CS8618
    public GenericRegistry()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The URL of the container registry
    /// </summary>
    public string Repository { get; set; } = string.Empty;

    /// <summary>
    /// The username for accessing the container registry
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// The password for accessing the container registry
    /// </summary>
    public string? Password { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type GenericRegistry");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("repository"));
        nestedObjectSerializer(Repository);

        if (Username != null)
        {
            emitter.Emit(new Scalar("username"));
            nestedObjectSerializer(Username);
        }


        if (Password != null)
        {
            emitter.Emit(new Scalar("password"));
            nestedObjectSerializer(Password);
        }

    }
}
