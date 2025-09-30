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
/// Represents a generic server tool that runs on a server
/// This tool kind is designed for operations that require server-side execution
/// It may include features such as authentication, data storage, and long-running processes
/// This tool kind is ideal for tasks that involve complex computations or access to secure resources
/// Server tools can be used to offload heavy processing from client applications
/// </summary>
[JsonConverter(typeof(ServerToolJsonConverter))]
public class ServerTool : Tool, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ServerTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public ServerTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for server tools. This is a wildcard and can represent any server tool type not explicitly defined.
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Connection configuration for the server tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// Configuration options for the server tool
    /// </summary>
    public IDictionary<string, object> Options { get; set; } = new Dictionary<string, object>();


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type ServerTool");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("connection"));
        nestedObjectSerializer(Connection);

        emitter.Emit(new Scalar("options"));
        nestedObjectSerializer(Options);
    }
}
