// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class AzureContainerRegistryJsonConverter : JsonConverter<AzureContainerRegistry>
{
    public override AzureContainerRegistry Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to AzureContainerRegistry.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing AzureContainerRegistry: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new AzureContainerRegistry();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("subscription", out JsonElement subscriptionValue))
            {
                instance.Subscription = subscriptionValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: subscription");
            }

            if (rootElement.TryGetProperty("resourceGroup", out JsonElement resourceGroupValue))
            {
                instance.ResourceGroup = resourceGroupValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: resourceGroup");
            }

            if (rootElement.TryGetProperty("registryName", out JsonElement registryNameValue))
            {
                instance.RegistryName = registryNameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: registryName");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, AzureContainerRegistry value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("subscription");
        JsonSerializer.Serialize(writer, value.Subscription, options);

        writer.WritePropertyName("resourceGroup");
        JsonSerializer.Serialize(writer, value.ResourceGroup, options);

        writer.WritePropertyName("registryName");
        JsonSerializer.Serialize(writer, value.RegistryName, options);

        writer.WriteEndObject();
    }
}