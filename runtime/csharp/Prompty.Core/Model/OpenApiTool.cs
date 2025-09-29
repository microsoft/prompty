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
[JsonConverter(typeof(OpenApiToolJsonConverter))]
public class OpenApiTool : Tool, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="OpenApiTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public OpenApiTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for OpenAPI tools
    /// </summary>
    public override string Kind { get; set; } = "openapi";

    /// <summary>
    /// The connection configuration for the OpenAPI tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The URL or relative path to the OpenAPI specification document (JSON or YAML format)
    /// </summary>
    public string Specification { get; set; } = string.Empty;


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type OpenApiTool");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing OpenApiTool: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("connection"));
        nestedObjectSerializer(Connection);

        emitter.Emit(new Scalar("specification"));
        nestedObjectSerializer(Specification);
    }
}
