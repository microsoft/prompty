// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Generic connection configuration for AI services.
/// </summary>
[JsonConverter(typeof(GenericConnectionConverter))]
public class GenericConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericConnection"/>.
    /// </summary>
    public GenericConnection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Additional options for the connection
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }

}

public class GenericConnectionConverter : JsonConverter<GenericConnection>
{
    public override GenericConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to GenericConnection.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing GenericConnection: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new GenericConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("options", out JsonElement optionsValue))
            {
                instance.Options = JsonSerializer.Deserialize<Dictionary<string, object>>(optionsValue.GetRawText(), options);
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, GenericConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Options != null)
        {
            writer.WritePropertyName("options");
            JsonSerializer.Serialize(writer, value.Options, options);
        }

        writer.WriteEndObject();
    }
}