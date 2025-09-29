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
/// Options for configuring the behavior of the AI model.
/// `kind` is a required property here, but this section can accept additional via options.
/// </summary>
[JsonConverter(typeof(ModelOptionsJsonConverter))]
public class ModelOptions : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
#pragma warning disable CS8618
    public ModelOptions()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// 
    /// </summary>
    public string Kind { get; set; } = string.Empty;


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type ModelOptions");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing ModelOptions: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);
    }
}
