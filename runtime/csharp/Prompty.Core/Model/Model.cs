// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Model for defining the structure and behavior of AI agents.
/// This model includes properties for specifying the model&#39;s provider, connection details, and various options.
/// It allows for flexible configuration of AI models to suit different use cases and requirements.
/// </summary>
[JsonConverter(typeof(ModelConverter))]
public class Model
{
    /// <summary>
    /// Initializes a new instance of <see cref="Model"/>.
    /// </summary>
    public Model()
    {
    }

    /// <summary>
    /// The unique identifier of the model - can be used as the single property shorthand
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// The publisher of the model (e.g., 'openai', 'azure', 'anthropic')
    /// </summary>
    public string? Publisher { get; set; }

    /// <summary>
    /// The connection configuration for the model
    /// </summary>
    public Connection? Connection { get; set; }

    /// <summary>
    /// Additional options for the model
    /// </summary>
    public ModelOptions? Options { get; set; }

}

public class ModelConverter : JsonConverter<Model>
{
    public override Model Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Model.");
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new ArgumentException("Empty string shorthand values for Model are not supported");
            return new Model()
            {
                Id = stringValue,
            };
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Model();
            if (rootElement.TryGetProperty("id", out JsonElement idValue))
            {
                instance.Id = idValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: id");
            }

            if (rootElement.TryGetProperty("publisher", out JsonElement publisherValue))
            {
                instance.Publisher = publisherValue.GetString();
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection?>(connectionValue.GetRawText(), options);
            }

            if (rootElement.TryGetProperty("options", out JsonElement optionsValue))
            {
                instance.Options = JsonSerializer.Deserialize<ModelOptions?>(optionsValue.GetRawText(), options);
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Model value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("id");
        JsonSerializer.Serialize(writer, value.Id, options);

        if (value.Publisher != null)
        {
            writer.WritePropertyName("publisher");
            JsonSerializer.Serialize(writer, value.Publisher, options);
        }

        if (value.Connection != null)
        {
            writer.WritePropertyName("connection");
            JsonSerializer.Serialize(writer, value.Connection, options);
        }

        if (value.Options != null)
        {
            writer.WritePropertyName("options");
            JsonSerializer.Serialize(writer, value.Options, options);
        }

        writer.WriteEndObject();
    }
}