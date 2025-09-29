// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class PromptyManifestJsonConverter : JsonConverter<PromptyManifest>
{
    public override PromptyManifest Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to PromptyManifest.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing PromptyManifest: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new PromptyManifest();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("models", out JsonElement modelsValue))
            {
                if (modelsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Models =
                        [.. modelsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Model> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Models are not supported"))];
                }

                else
                {
                    throw new JsonException("Invalid JSON token for models");
                }
            }

            if (rootElement.TryGetProperty("parameters", out JsonElement parametersValue))
            {
                if (parametersValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Parameter> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Parameters are not supported"))];
                }

                else if (parametersValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Parameter>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Parameters are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }

                else
                {
                    throw new JsonException("Invalid JSON token for parameters");
                }
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyManifest value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("models");
        JsonSerializer.Serialize(writer, value.Models, options);

        writer.WritePropertyName("parameters");
        JsonSerializer.Serialize(writer, value.Parameters, options);

        writer.WriteEndObject();
    }
}