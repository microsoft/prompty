// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template parser definition
/// </summary>
[JsonConverter(typeof(ParserConverter))]
public class Parser
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
    public Parser()
    {
    }

    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Options for the parser
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }

}

public class ParserConverter : JsonConverter<Parser>
{
    public override Parser Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Parser.");
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new ArgumentException("Empty string shorthand values for Parser are not supported");
            return new Parser()
            {
                Kind = stringValue,
            };
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Parser();
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

    public override void Write(Utf8JsonWriter writer, Parser value, JsonSerializerOptions options)
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