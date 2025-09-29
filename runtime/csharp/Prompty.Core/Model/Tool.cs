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
/// Represents a tool that can be used in prompts.
/// </summary>
[JsonConverter(typeof(ToolJsonConverter))]
public abstract class Tool : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Tool"/>.
    /// </summary>
#pragma warning disable CS8618
    protected Tool()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the tool. If a function tool, this is the function name, otherwise it is the type
    /// </summary>
    public virtual string Name { get; set; } = string.Empty;

    /// <summary>
    /// The kind identifier for the tool
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the tool for metadata purposes
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Tool argument bindings to input properties
    /// </summary>
    public IList<Binding>? Bindings { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type Tool");
            }

            // handle polymorphic types
            if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
            {
                var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
                switch (discriminatorValue)
                {
                    case "function":
                        var functionTool = nestedObjectDeserializer(typeof(FunctionTool)) as FunctionTool;
                        if (functionTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type FunctionTool");
                        }
                        return;
                    case "bing_search":
                        var bing_searchTool = nestedObjectDeserializer(typeof(BingSearchTool)) as BingSearchTool;
                        if (bing_searchTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type BingSearchTool");
                        }
                        return;
                    case "file_search":
                        var file_searchTool = nestedObjectDeserializer(typeof(FileSearchTool)) as FileSearchTool;
                        if (file_searchTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type FileSearchTool");
                        }
                        return;
                    case "mcp":
                        var mcpTool = nestedObjectDeserializer(typeof(McpTool)) as McpTool;
                        if (mcpTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type McpTool");
                        }
                        return;
                    case "model":
                        var modelTool = nestedObjectDeserializer(typeof(ModelTool)) as ModelTool;
                        if (modelTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type ModelTool");
                        }
                        return;
                    case "openapi":
                        var openapiTool = nestedObjectDeserializer(typeof(OpenApiTool)) as OpenApiTool;
                        if (openapiTool == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type OpenApiTool");
                        }
                        return;
                    default:
                        throw new YamlException($"Unknown type discriminator '' when parsing Tool");
                }
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing Tool: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Description != null)
        {
            emitter.Emit(new Scalar("description"));
            nestedObjectSerializer(Description);
        }


        if (Bindings != null)
        {
            emitter.Emit(new Scalar("bindings"));
            nestedObjectSerializer(Bindings);
        }

    }
}
