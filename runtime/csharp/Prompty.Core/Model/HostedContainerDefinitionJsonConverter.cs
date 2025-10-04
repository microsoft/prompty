// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class HostedContainerDefinitionJsonConverter : JsonConverter<HostedContainerDefinition>
{
    public override HostedContainerDefinition Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to HostedContainerDefinition.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing HostedContainerDefinition: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new HostedContainerDefinition();
            if (rootElement.TryGetProperty("scale", out JsonElement scaleValue))
            {
                instance.Scale = JsonSerializer.Deserialize<Scale>(scaleValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: scale");
            }

            if (rootElement.TryGetProperty("context", out JsonElement contextValue))
            {
                instance.Context = contextValue.GetScalarValue() ?? throw new ArgumentException("Properties must contain a property named: context");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, HostedContainerDefinition value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("scale");
        JsonSerializer.Serialize(writer, value.Scale, options);

        writer.WritePropertyName("context");
        JsonSerializer.Serialize(writer, value.Context, options);

        writer.WriteEndObject();
    }
}