// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using API keys.
/// </summary>
[JsonConverter(typeof(KeyConnectionConverter))]
public class KeyConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="KeyConnection"/>.
    /// </summary>
    public KeyConnection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "key";

    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The API key for authenticating with the AI service
    /// </summary>
    public string Key { get; set; } = string.Empty;

}

public class KeyConnectionConverter : JsonConverter<KeyConnection>
{
    public override KeyConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to KeyConnection.");
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