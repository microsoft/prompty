// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class InputJsonConverter : JsonConverter<Input>
{
    public override Input Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Input.");
        }
        else if (reader.TokenType == JsonTokenType.True || reader.TokenType == JsonTokenType.False)
        {
            var boolValue = reader.GetBoolean();
            return new Input()
            {
                Kind = "boolean",
                Sample = boolValue,
            };
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new JsonException("Empty string shorthand values for Input are not supported");
            return new Input()
            {
                Kind = "string",
                Sample = stringValue,
            };
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            byte[] span = reader.HasValueSequence ?
                        reader.ValueSequence.ToArray() :
                        reader.ValueSpan.ToArray();

            var numberString = System.Text.Encoding.UTF8.GetString(span);
            if (numberString.Contains('.') || numberString.Contains('e') || numberString.Contains('E'))
            {
                // try parse as float
                if (float.TryParse(numberString, out float floatValue))
                {
                    return new Input()
                    {
                        Kind = "float",
                        Sample = floatValue,
                    };
                }
            }
            else
            {
                // try parse as int
                if (int.TryParse(numberString, out int intValue))
                {
                    return new Input()
                    {
                        Kind = "integer",
                        Sample = intValue,
                    };
                }
            }
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing Input: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic Input instance
            Input instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for Input is not supported");
                instance = discriminator switch
                {
                    "array" => JsonSerializer.Deserialize<ArrayInput>(rootElement, options)
                        ?? throw new JsonException("Empty ArrayInput instances are not supported"),
                    "object" => JsonSerializer.Deserialize<ObjectInput>(rootElement, options)
                        ?? throw new JsonException("Empty ObjectInput instances are not supported"),
                    _ => new Input(),
                };
            }
            else
            {
                throw new JsonException("Missing Input discriminator property: 'kind'");
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = descriptionValue.GetString();
            }

            if (rootElement.TryGetProperty("required", out JsonElement requiredValue))
            {
                instance.Required = requiredValue.GetBoolean();
            }

            if (rootElement.TryGetProperty("strict", out JsonElement strictValue))
            {
                instance.Strict = strictValue.GetBoolean();
            }

            if (rootElement.TryGetProperty("default", out JsonElement defaultValue))
            {
                instance.Default = defaultValue.GetScalarValue();
            }

            if (rootElement.TryGetProperty("sample", out JsonElement sampleValue))
            {
                instance.Sample = sampleValue.GetScalarValue();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Input value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }

        if (value.Required != null)
        {
            writer.WritePropertyName("required");
            JsonSerializer.Serialize(writer, value.Required, options);
        }

        if (value.Strict != null)
        {
            writer.WritePropertyName("strict");
            JsonSerializer.Serialize(writer, value.Strict, options);
        }

        if (value.Default != null)
        {
            writer.WritePropertyName("default");
            JsonSerializer.Serialize(writer, value.Default, options);
        }

        if (value.Sample != null)
        {
            writer.WritePropertyName("sample");
            JsonSerializer.Serialize(writer, value.Sample, options);
        }

        writer.WriteEndObject();
    }
}