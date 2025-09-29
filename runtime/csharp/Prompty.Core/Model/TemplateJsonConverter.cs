// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class TemplateJsonConverter : JsonConverter<Template>
{
    public override Template Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Template.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing Template: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Template();
            if (rootElement.TryGetProperty("format", out JsonElement formatValue))
            {
                instance.Format = JsonSerializer.Deserialize<Format>(formatValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: format");
            }

            if (rootElement.TryGetProperty("parser", out JsonElement parserValue))
            {
                instance.Parser = JsonSerializer.Deserialize<Parser>(parserValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: parser");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Template value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("format");
        JsonSerializer.Serialize(writer, value.Format, options);

        writer.WritePropertyName("parser");
        JsonSerializer.Serialize(writer, value.Parser, options);

        writer.WriteEndObject();
    }
}