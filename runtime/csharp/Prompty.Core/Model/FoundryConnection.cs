// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// 
/// </summary>
[JsonConverter(typeof(FoundryConnectionConverter))]
public class FoundryConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
    public FoundryConnection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "foundry";

    /// <summary>
    /// The Foundry endpoint URL for the AI service
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>
    /// The Foundry connection name
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The Foundry project name
    /// </summary>
    public string Project { get; set; } = string.Empty;

}

public class FoundryConnectionConverter : JsonConverter<FoundryConnection>
{
    public override FoundryConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to FoundryConnection.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new FoundryConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("type", out JsonElement typeValue))
            {
                instance.Type = typeValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: type");
            }

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("project", out JsonElement projectValue))
            {
                instance.Project = projectValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: project");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, FoundryConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("type");
        JsonSerializer.Serialize(writer, value.Type, options);

        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("project");
        JsonSerializer.Serialize(writer, value.Project, options);

        writer.WriteEndObject();
    }
}