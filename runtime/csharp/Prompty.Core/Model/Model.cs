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
/// Model for defining the structure and behavior of AI agents.
/// This model includes properties for specifying the model&#39;s provider, connection details, and various options.
/// It allows for flexible configuration of AI models to suit different use cases and requirements.
/// </summary>
[JsonConverter(typeof(ModelJsonConverter))]
public class Model : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Model"/>.
    /// </summary>
#pragma warning disable CS8618
    public Model()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The unique identifier of the model - can be used as the single property shorthand
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// The publisher of the model (e.g., 'openai', 'azure', 'anthropic')
    /// </summary>
    public string? Publisher { get; set; }

    /// <summary>
    /// The connection configuration for the model
    /// </summary>
    public Connection? Connection { get; set; }

    /// <summary>
    /// Additional options for the model
    /// </summary>
    public ModelOptions? Options { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {
        if (parser.TryConsume<Scalar>(out var scalar))
        {
            // check for non-numeric characters to differentiate strings from numbers
            if (scalar.Value.Length > 0 && scalar.Value.Any(c => !char.IsDigit(c) && c != '.' && c != '-'))
            {
                var stringValue = scalar.Value;
                Id = stringValue;
                return;
            }
            else
            {
                throw new YamlException($"Unexpected scalar value '' when parsing Model. Expected one of the supported shorthand types or a mapping.");
            }
        }

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type Model");
        }

    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("id"));
        nestedObjectSerializer(Id);

        if (Publisher != null)
        {
            emitter.Emit(new Scalar("publisher"));
            nestedObjectSerializer(Publisher);
        }


        if (Connection != null)
        {
            emitter.Emit(new Scalar("connection"));
            nestedObjectSerializer(Connection);
        }


        if (Options != null)
        {
            emitter.Emit(new Scalar("options"));
            nestedObjectSerializer(Options);
        }

    }
}
