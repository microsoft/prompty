// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class PromptyJsonConverter : JsonConverter<Prompty>
{
    public override Prompty Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Prompty.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing Prompty: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Prompty();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("template", out JsonElement templateValue))
            {
                instance.Template = JsonSerializer.Deserialize<Template?>(templateValue.GetRawText(), options);
            }

            if (rootElement.TryGetProperty("instructions", out JsonElement instructionsValue))
            {
                instance.Instructions = instructionsValue.GetString();
            }

            if (rootElement.TryGetProperty("additionalInstructions", out JsonElement additionalInstructionsValue))
            {
                instance.AdditionalInstructions = additionalInstructionsValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Prompty value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Template != null)
        {
            writer.WritePropertyName("template");
            JsonSerializer.Serialize(writer, value.Template, options);
        }

        if (value.Instructions != null)
        {
            writer.WritePropertyName("instructions");
            JsonSerializer.Serialize(writer, value.Instructions, options);
        }

        if (value.AdditionalInstructions != null)
        {
            writer.WritePropertyName("additionalInstructions");
            JsonSerializer.Serialize(writer, value.AdditionalInstructions, options);
        }

        writer.WriteEndObject();
    }
}