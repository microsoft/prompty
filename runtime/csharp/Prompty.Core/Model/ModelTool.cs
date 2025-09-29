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
[JsonConverter(typeof(ModelToolJsonConverter))]
public class ModelTool : Tool, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public ModelTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for a model connection as a tool
    /// </summary>
    public override string Kind { get; set; } = "model";

    /// <summary>
    /// The connection configuration for the model tool
    /// </summary>
    public Model Model { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type ModelTool");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing ModelTool: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("model"));
        nestedObjectSerializer(Model);
    }
}
