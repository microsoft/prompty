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
/// Represents a binding between an input property and a tool parameter.
/// </summary>
[JsonConverter(typeof(BindingJsonConverter))]
public class Binding : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
#pragma warning disable CS8618
    public Binding()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Name of the binding
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The input property that will be bound to the tool parameter argument
    /// </summary>
    public string Input { get; set; } = string.Empty;


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        if (parser.TryConsume<Scalar>(out var scalar))
        {
            // check for non-numeric characters to differentiate strings from numbers
            if (scalar.Value.Length > 0 && scalar.Value.Any(c => !char.IsDigit(c) && c != '.' && c != '-'))
            {
                var stringValue = scalar.Value;
                Input = stringValue;
                return;
            }
            else
            {
                throw new YamlException($"Unexpected scalar value '' when parsing Binding. Expected one of the supported shorthand types or a mapping.");
            }
        }



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type Binding");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing Binding: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        emitter.Emit(new Scalar("input"));
        nestedObjectSerializer(Input);
    }
}
