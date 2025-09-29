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
/// Represents a single input property for a prompt.
/// * This model defines the structure of input properties that can be used in prompts,
/// including their type, description, whether they are required, and other attributes.
/// * It allows for the definition of dynamic inputs that can be filled with data
/// and processed to generate prompts for AI models.
/// </summary>
[JsonConverter(typeof(InputJsonConverter))]
public class Input : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Input"/>.
    /// </summary>
#pragma warning disable CS8618
    public Input()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the input property
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data type of the input property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the input property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the input property is required
    /// </summary>
    public bool? Required { get; set; }

    /// <summary>
    /// Whether the input property can emit structural text when parsing output
    /// </summary>
    public bool? Strict { get; set; }

    /// <summary>
    /// The default value of the input - this represents the default value if none is provided
    /// </summary>
    public object? Default { get; set; }

    /// <summary>
    /// A sample value of the input for examples and tooling
    /// </summary>
    public object? Sample { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        if (parser.TryConsume<Scalar>(out var scalar))
        {
            if (scalar.Value.ToLower() == "true" || scalar.Value.ToLower() == "false")
            {
                var boolValue = scalar.Value.ToLower() == "true";
                Kind = "boolean";
                Sample = boolValue;
                return;
            }
            // check for non-numeric characters to differentiate strings from numbers
            else if (scalar.Value.Length > 0 && scalar.Value.Any(c => !char.IsDigit(c) && c != '.' && c != '-'))
            {
                var stringValue = scalar.Value;
                Kind = "string";
                Sample = stringValue;
                return;
            }
            else if (scalar.Value.Contains('.') || scalar.Value.Contains('e') || scalar.Value.Contains('E'))
            {
                // try parse as float
                if (float.TryParse(scalar.Value, out float floatValue))
                {
                    Kind = "float";
                    Sample = floatValue;
                    return;
                }
            }
            else if (scalar.Value.All(c => char.IsDigit(c)))
            {
                // try parse as int
                if (int.TryParse(scalar.Value, out int intValue))
                {
                    Kind = "integer";
                    Sample = intValue;
                    return;
                }
            }
            else
            {
                throw new YamlException($"Unexpected scalar value '' when parsing Input. Expected one of the supported shorthand types or a mapping.");
            }
        }



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type Input");
            }

            // handle polymorphic types
            if (node.Children.TryGetValue(new YamlScalarNode("kind"), out var discriminatorNode))
            {
                var discriminatorValue = (discriminatorNode as YamlScalarNode)?.Value;
                switch (discriminatorValue)
                {
                    case "array":
                        var arrayInput = nestedObjectDeserializer(typeof(ArrayInput)) as ArrayInput;
                        if (arrayInput == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type ArrayInput");
                        }
                        return;
                    case "object":
                        var objectInput = nestedObjectDeserializer(typeof(ObjectInput)) as ObjectInput;
                        if (objectInput == null)
                        {
                            throw new YamlException("Failed to deserialize polymorphic type ObjectInput");
                        }
                        return;
                    default:
                        throw new YamlException($"Unknown type discriminator '' when parsing Input");
                }
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing Input: {parser.Current?.GetType().Name ?? "null"}");
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


        if (Strict != null)
        {
            emitter.Emit(new Scalar("strict"));
            nestedObjectSerializer(Strict);
        }


        if (Default != null)
        {
            emitter.Emit(new Scalar("default"));
            nestedObjectSerializer(Default);
        }


        if (Sample != null)
        {
            emitter.Emit(new Scalar("sample"));
            nestedObjectSerializer(Sample);
        }

    }
}
