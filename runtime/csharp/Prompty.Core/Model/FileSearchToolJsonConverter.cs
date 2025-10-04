// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class FileSearchToolJsonConverter : JsonConverter<FileSearchTool>
{
    public override FileSearchTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to FileSearchTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing FileSearchTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new FileSearchTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: connection");
            }

            if (rootElement.TryGetProperty("maxNumResults", out JsonElement maxNumResultsValue))
            {
                instance.MaxNumResults = maxNumResultsValue.GetInt32();
            }

            if (rootElement.TryGetProperty("ranker", out JsonElement rankerValue))
            {
                instance.Ranker = rankerValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: ranker");
            }

            if (rootElement.TryGetProperty("scoreThreshold", out JsonElement scoreThresholdValue))
            {
                instance.ScoreThreshold = scoreThresholdValue.GetSingle();
            }

            if (rootElement.TryGetProperty("vectorStoreIds", out JsonElement vectorStoreIdsValue))
            {
                instance.VectorStoreIds = [.. vectorStoreIdsValue.EnumerateArray().Select(x => x.GetString() ?? throw new JsonException("Empty array elements for vectorStoreIds are not supported"))];
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, FileSearchTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("connection");
        JsonSerializer.Serialize(writer, value.Connection, options);

        if (value.MaxNumResults != null)
        {
            writer.WritePropertyName("maxNumResults");
            JsonSerializer.Serialize(writer, value.MaxNumResults, options);
        }

        writer.WritePropertyName("ranker");
        JsonSerializer.Serialize(writer, value.Ranker, options);

        writer.WritePropertyName("scoreThreshold");
        JsonSerializer.Serialize(writer, value.ScoreThreshold, options);

        writer.WritePropertyName("vectorStoreIds");
        JsonSerializer.Serialize(writer, value.VectorStoreIds, options);

        writer.WriteEndObject();
    }
}