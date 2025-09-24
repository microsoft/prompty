// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI agents.
/// `provider`, `kind`, and `endpoint` are required properties here,
/// but this section can accept additional via options.
/// </summary>
[JsonConverter(typeof(ConnectionConverter))]
public abstract class Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
    protected Connection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')
    /// </summary>
    public string Authority { get; set; } = "system";

    /// <summary>
    /// The usage description for the connection, providing context on how this connection will be used
    /// </summary>
    public string? UsageDescription { get; set; }

}

public class ConnectionConverter : JsonConverter<Connection>
{
    public override Connection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Connection.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing Connection: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic Connection instance
            Connection instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for Connection is not supported");
                instance = discriminator switch
                {
                    "reference" => JsonSerializer.Deserialize<ReferenceConnection>(rootElement, options)
                        ?? throw new JsonException("Empty ReferenceConnection instances are not supported"),
                    "key" => JsonSerializer.Deserialize<KeyConnection>(rootElement, options)
                        ?? throw new JsonException("Empty KeyConnection instances are not supported"),
                    "oauth" => JsonSerializer.Deserialize<OAuthConnection>(rootElement, options)
                        ?? throw new JsonException("Empty OAuthConnection instances are not supported"),
                    "foundry" => JsonSerializer.Deserialize<FoundryConnection>(rootElement, options)
                        ?? throw new JsonException("Empty FoundryConnection instances are not supported"),
                    _ => new GenericConnection(),
                };
            }
            else
            {
                throw new JsonException("Missing Connection discriminator property: 'kind'");
            }
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("authority", out JsonElement authorityValue))
            {
                instance.Authority = authorityValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: authority");
            }

            if (rootElement.TryGetProperty("usageDescription", out JsonElement usageDescriptionValue))
            {
                instance.UsageDescription = usageDescriptionValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Connection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("authority");
        JsonSerializer.Serialize(writer, value.Authority, options);

        if (value.UsageDescription != null)
        {
            writer.WritePropertyName("usageDescription");
            JsonSerializer.Serialize(writer, value.UsageDescription, options);
        }

        writer.WriteEndObject();
    }
}