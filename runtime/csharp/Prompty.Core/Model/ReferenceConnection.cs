// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using named connections.
/// </summary>
[JsonConverter(typeof(ReferenceConnectionConverter))]
public class ReferenceConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
    public ReferenceConnection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "reference";

    /// <summary>
    /// The name of the connection
    /// </summary>
    public string Name { get; set; } = string.Empty;

}

public class ReferenceConnectionConverter : JsonConverter<ReferenceConnection>
{
    public override ReferenceConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ReferenceConnection.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ReferenceConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ReferenceConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WriteEndObject();
    }
}