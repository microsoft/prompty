// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class BingSearchConfigurationJsonConverter : JsonConverter<BingSearchConfiguration>
{
    public override BingSearchConfiguration Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to BingSearchConfiguration.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing BingSearchConfiguration: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new BingSearchConfiguration();
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("market", out JsonElement marketValue))
            {
                instance.Market = marketValue.GetString();
            }

            if (rootElement.TryGetProperty("setLang", out JsonElement setLangValue))
            {
                instance.SetLang = setLangValue.GetString();
            }

            if (rootElement.TryGetProperty("count", out JsonElement countValue))
            {
                instance.Count = countValue.GetInt64();
            }

            if (rootElement.TryGetProperty("freshness", out JsonElement freshnessValue))
            {
                instance.Freshness = freshnessValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, BingSearchConfiguration value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        if (value.Market != null)
        {
            writer.WritePropertyName("market");
            JsonSerializer.Serialize(writer, value.Market, options);
        }

        if (value.SetLang != null)
        {
            writer.WritePropertyName("setLang");
            JsonSerializer.Serialize(writer, value.SetLang, options);
        }

        if (value.Count != null)
        {
            writer.WritePropertyName("count");
            JsonSerializer.Serialize(writer, value.Count, options);
        }

        if (value.Freshness != null)
        {
            writer.WritePropertyName("freshness");
            JsonSerializer.Serialize(writer, value.Freshness, options);
        }

        writer.WriteEndObject();
    }
}