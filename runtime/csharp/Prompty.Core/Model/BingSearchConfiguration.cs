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
/// Configuration options for the Bing search tool.
/// </summary>
[JsonConverter(typeof(BingSearchConfigurationJsonConverter))]
public class BingSearchConfiguration : IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchConfiguration"/>.
    /// </summary>
#pragma warning disable CS8618
    public BingSearchConfiguration()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The name of the Bing search tool instance, used to identify the specific instance in the system
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The market where the results come from.
    /// </summary>
    public string? Market { get; set; }

    /// <summary>
    /// The language to use for user interface strings when calling Bing API.
    /// </summary>
    public string? SetLang { get; set; }

    /// <summary>
    /// The number of search results to return in the bing api response
    /// </summary>
    public long? Count { get; set; }

    /// <summary>
    /// Filter search results by a specific time range. Accepted values: https://learn.microsoft.com/bing/search-apis/bing-web-search/reference/query-parameters
    /// </summary>
    public string? Freshness { get; set; }


    public void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type BingSearchConfiguration");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing BingSearchConfiguration: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("name"));
        nestedObjectSerializer(Name);

        if (Market != null)
        {
            emitter.Emit(new Scalar("market"));
            nestedObjectSerializer(Market);
        }


        if (SetLang != null)
        {
            emitter.Emit(new Scalar("setLang"));
            nestedObjectSerializer(SetLang);
        }


        if (Count != null)
        {
            emitter.Emit(new Scalar("count"));
            nestedObjectSerializer(Count);
        }


        if (Freshness != null)
        {
            emitter.Emit(new Scalar("freshness"));
            nestedObjectSerializer(Freshness);
        }

    }
}
