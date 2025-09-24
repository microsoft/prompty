// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using OAuth authentication.
/// </summary>
[JsonConverter(typeof(OAuthConnectionConverter))]
public class OAuthConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="OAuthConnection"/>.
    /// </summary>
    public OAuthConnection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "oauth";

    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client ID for authenticating with the AI service
    /// </summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client secret for authenticating with the AI service
    /// </summary>
    public string ClientSecret { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth token URL for obtaining access tokens
    /// </summary>
    public string TokenUrl { get; set; } = string.Empty;

    /// <summary>
    /// The scopes required for the OAuth token
    /// </summary>
    public IList<string> Scopes { get; set; } = [];

}

public class OAuthConnectionConverter : JsonConverter<OAuthConnection>
{
    public override OAuthConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to OAuthConnection.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing OAuthConnection: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new OAuthConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("endpoint", out JsonElement endpointValue))
            {
                instance.Endpoint = endpointValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: endpoint");
            }

            if (rootElement.TryGetProperty("clientId", out JsonElement clientIdValue))
            {
                instance.ClientId = clientIdValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: clientId");
            }

            if (rootElement.TryGetProperty("clientSecret", out JsonElement clientSecretValue))
            {
                instance.ClientSecret = clientSecretValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: clientSecret");
            }

            if (rootElement.TryGetProperty("tokenUrl", out JsonElement tokenUrlValue))
            {
                instance.TokenUrl = tokenUrlValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: tokenUrl");
            }

            if (rootElement.TryGetProperty("scopes", out JsonElement scopesValue))
            {
                instance.Scopes = [.. scopesValue.EnumerateArray().Select(x => x.GetString() ?? throw new JsonException("Empty array elements for scopes are not supported"))];
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, OAuthConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("endpoint");
        JsonSerializer.Serialize(writer, value.Endpoint, options);

        writer.WritePropertyName("clientId");
        JsonSerializer.Serialize(writer, value.ClientId, options);

        writer.WritePropertyName("clientSecret");
        JsonSerializer.Serialize(writer, value.ClientSecret, options);

        writer.WritePropertyName("tokenUrl");
        JsonSerializer.Serialize(writer, value.TokenUrl, options);

        writer.WritePropertyName("scopes");
        JsonSerializer.Serialize(writer, value.Scopes, options);

        writer.WriteEndObject();
    }
}