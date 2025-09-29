// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class ObjectInputJsonConverter : JsonConverter<ObjectInput>
{
    public override ObjectInput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ObjectInput.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing ObjectInput: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ObjectInput();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("properties", out JsonElement propertiesValue))
            {
                if (propertiesValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Properties =
                        [.. propertiesValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Input> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Properties are not supported"))];
                }

                else if (propertiesValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Properties =
                        [.. propertiesValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Input>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Properties are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }

                else
                {
                    throw new JsonException("Invalid JSON token for properties");
                }
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ObjectInput value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("properties");
        JsonSerializer.Serialize(writer, value.Properties, options);

        writer.WriteEndObject();
    }
}