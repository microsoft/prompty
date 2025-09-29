// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class ContainerDefinitionJsonConverter : JsonConverter<ContainerDefinition>
{
    public override ContainerDefinition Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ContainerDefinition.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing ContainerDefinition: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ContainerDefinition();
            if (rootElement.TryGetProperty("image", out JsonElement imageValue))
            {
                instance.Image = imageValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: image");
            }

            if (rootElement.TryGetProperty("tag", out JsonElement tagValue))
            {
                instance.Tag = tagValue.GetString();
            }

            if (rootElement.TryGetProperty("registry", out JsonElement registryValue))
            {
                instance.Registry = JsonSerializer.Deserialize<Registry>(registryValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: registry");
            }

            if (rootElement.TryGetProperty("scale", out JsonElement scaleValue))
            {
                instance.Scale = JsonSerializer.Deserialize<Scale>(scaleValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: scale");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ContainerDefinition value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("image");
        JsonSerializer.Serialize(writer, value.Image, options);

        if (value.Tag != null)
        {
            writer.WritePropertyName("tag");
            JsonSerializer.Serialize(writer, value.Tag, options);
        }

        writer.WritePropertyName("registry");
        JsonSerializer.Serialize(writer, value.Registry, options);

        writer.WritePropertyName("scale");
        JsonSerializer.Serialize(writer, value.Scale, options);

        writer.WriteEndObject();
    }
}