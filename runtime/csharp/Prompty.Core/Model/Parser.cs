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
/// Template parser definition
/// </summary>
[JsonConverter(typeof(ParserJsonConverter))]
public class Parser : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
#pragma warning disable CS8618
    public Parser()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Options for the parser
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
                throw new YamlException($"Unexpected scalar value '' when parsing Parser. Expected one of the supported shorthand types or a mapping.");
            }
        }

        var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
        if (node == null)
        {
            throw new YamlException("Expected a mapping node for type Parser");
        }

    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        if (Options != null)
        {
            emitter.Emit(new Scalar("options"));
            nestedObjectSerializer(Options);
        }

    }
}
