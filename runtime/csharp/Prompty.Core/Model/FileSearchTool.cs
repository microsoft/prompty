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
/// A tool for searching files.
/// This tool allows an AI agent to search for files based on a query.
/// </summary>
[JsonConverter(typeof(FileSearchToolJsonConverter))]
public class FileSearchTool : Tool, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="FileSearchTool"/>.
    /// </summary>
#pragma warning disable CS8618
    public FileSearchTool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The kind identifier for file search tools
    /// </summary>
    public override string Kind { get; set; } = "file_search";

    /// <summary>
    /// The connection configuration for the file search tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The maximum number of search results to return.
    /// </summary>
    public int? MaxNumResults { get; set; }

    /// <summary>
    /// File search ranker.
    /// </summary>
    public string Ranker { get; set; } = string.Empty;

    /// <summary>
    /// Ranker search threshold.
    /// </summary>
    public float ScoreThreshold { get; set; }


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type FileSearchTool");
        }

    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("connection"));
        nestedObjectSerializer(Connection);

        if (MaxNumResults != null)
        {
            emitter.Emit(new Scalar("maxNumResults"));
            nestedObjectSerializer(MaxNumResults);
        }


        emitter.Emit(new Scalar("ranker"));
        nestedObjectSerializer(Ranker);

        emitter.Emit(new Scalar("scoreThreshold"));
        nestedObjectSerializer(ScoreThreshold);
    }
}
