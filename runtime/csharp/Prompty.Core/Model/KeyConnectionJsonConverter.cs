// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class KeyConnectionJsonConverter : JsonConverter<KeyConnection>
{
    public override KeyConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to KeyConnection.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing KeyConnection: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new KeyConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("endpoint", out JsonElement endpointValue))
            {
                instance.Endpoint = endpointValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: endpoint");
            }

            if (rootElement.TryGetProperty("key", out JsonElement keyValue))
            {
                instance.Key = keyValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: key");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, KeyConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("endpoint");
        JsonSerializer.Serialize(writer, value.Endpoint, options);

        writer.WritePropertyName("key");
        JsonSerializer.Serialize(writer, value.Key, options);

        writer.WriteEndObject();
    }
}