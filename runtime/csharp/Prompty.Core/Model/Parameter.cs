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
/// Represents a parameter for a tool.
/// </summary>
[JsonConverter(typeof(ParameterJsonConverter))]
public class Parameter : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parameter"/>.
    /// </summary>
#pragma warning disable CS8618
    public Parameter()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the parameter
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data type of the parameter
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the tool parameter is required
    /// </summary>
    public bool? Required { get; set; }

    /// <summary>
    /// The default value of the parameter - this represents the default value if none is provided
    /// </summary>
    public object? Default { get; set; }

    /// <summary>
    /// Parameter value used for initializing manifest examples and tooling
    /// </summary>
    public object? Value { get; set; }

    /// <summary>
    /// Allowed enumeration values for the parameter
    /// </summary>
    public IList<object>? Enum { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type Parameter");
            }

            // handle polymorphic types
            if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
            {
                var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
                switch (discriminatorValue)
                {
                    case "object":
                        var objectParameter = nestedObjectDeserializer(typeof(ObjectParameter)) as ObjectParameter;
                        if (objectParameter == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type ObjectParameter");
                        }
                        return;
                    case "array":
                        var arrayParameter = nestedObjectDeserializer(typeof(ArrayParameter)) as ArrayParameter;
                        if (arrayParameter == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type ArrayParameter");
                        }
                        return;
                    default:
                        throw new YamlException($"Unknown type discriminator '' when parsing Parameter");
                }
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing Parameter: {parser.Current?.GetType().Name ?? "null"}");
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


        if (Required != null)
        {
            emitter.Emit(new Scalar("required"));
            nestedObjectSerializer(Required);
        }


        if (Default != null)
        {
            emitter.Emit(new Scalar("default"));
            nestedObjectSerializer(Default);
        }


        if (Value != null)
        {
            emitter.Emit(new Scalar("value"));
            nestedObjectSerializer(Value);
        }


        if (Enum != null)
        {
            emitter.Emit(new Scalar("enum"));
            nestedObjectSerializer(Enum);
        }

    }
}
