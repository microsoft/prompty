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
/// The MCP Server tool.
/// </summary>
[JsonConverter(typeof(McpToolJsonConverter))]
public class McpTool : Tool, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public McpTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for MCP tools
    /// </summary>
    public override string Kind { get; set; } = "mcp";

    /// <summary>
    /// The connection configuration for the MCP tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The name of the MCP tool
    /// </summary>
    public override string Name { get; set; } = string.Empty;

    /// <summary>
    /// The URL of the MCP server
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// List of allowed operations or resources for the MCP tool
    /// </summary>
    public IList<string> Allowed { get; set; } = [];


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type McpTool");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing McpTool: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("connection"));
        nestedObjectSerializer(Connection);

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        emitter.Emit(new Scalar("url"));
        nestedObjectSerializer(Url);

        emitter.Emit(new Scalar("allowed"));
        nestedObjectSerializer(Allowed);
    }
}
