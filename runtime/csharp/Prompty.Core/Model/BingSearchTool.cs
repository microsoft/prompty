// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The Bing search tool.
/// </summary>
[JsonConverter(typeof(BingSearchToolConverter))]
public class BingSearchTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchTool"/>.
    /// </summary>
    public BingSearchTool()
    {
    }

    /// <summary>
    /// The kind identifier for Bing search tools
    /// </summary>
    public override string Kind { get; set; } = "bing_search";

    /// <summary>
    /// The connection configuration for the Bing search tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The configuration options for the Bing search tool
    /// </summary>
    public IList<BingSearchConfiguration> Configurations { get; set; } = [];


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new BingSearchTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new BingSearchTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("configurations", out var configurationsValue))
        {
            instance.Configurations = LoadConfigurations(configurationsValue);
        }
        return instance;
    }
    
    internal static IList<BingSearchConfiguration> LoadConfigurations(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => BingSearchConfiguration.Load(item))];
    }
    
    
    */
}


public class BingSearchToolConverter : JsonConverter<BingSearchTool>
{
    public override BingSearchTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to BingSearchTool.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new BingSearchTool();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: connection");
            }

            if (rootElement.TryGetProperty("configurations", out JsonElement configurationsValue))
            {
                // need object collection deserialization
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, BingSearchTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("connection");
        JsonSerializer.Serialize(writer, value.Connection, options);

        writer.WritePropertyName("configurations");
        JsonSerializer.Serialize(writer, value.Configurations, options);

        writer.WriteEndObject();
    }
}