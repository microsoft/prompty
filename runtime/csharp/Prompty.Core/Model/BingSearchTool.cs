// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
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

}

public class BingSearchToolConverter : JsonConverter<BingSearchTool>
{
    public override BingSearchTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to BingSearchTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing BingSearchTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
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
                if (configurationsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Configurations =
                        [.. configurationsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<BingSearchConfiguration> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Configurations are not supported"))];
                }
                else if (configurationsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Configurations =
                        [.. configurationsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<BingSearchConfiguration>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Configurations are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for configurations");
                }
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