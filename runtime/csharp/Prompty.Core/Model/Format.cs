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
/// Template format definition
/// </summary>
[JsonConverter(typeof(FormatJsonConverter))]
public class Format : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Format"/>.
    /// </summary>
#pragma warning disable CS8618
    public Format()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Whether the template can emit structural text for parsing output
    /// </summary>
    public bool? Strict { get; set; }

    /// <summary>
    /// Options for the template engine
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {

        if (parser.TryConsume<Scalar>(out var scalar))
        {
            // check for non-numeric characters to differentiate strings from numbers
            if (scalar.Value.Length > 0 && scalar.Value.Any(c => !char.IsDigit(c) && c != '.' && c != '-'))
            {
                var stringValue = scalar.Value;
                Kind = stringValue;
                return;
            }
            else
            {
                throw new YamlException($"Unexpected scalar value '' when parsing Format. Expected one of the supported shorthand types or a mapping.");
            }
        }



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type Format");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing Format: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Strict != null)
        {
            emitter.Emit(new Scalar("strict"));
            nestedObjectSerializer(Strict);
        }


        if (Options != null)
        {
            emitter.Emit(new Scalar("options"));
            nestedObjectSerializer(Options);
        }

    }
}
