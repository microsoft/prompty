// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template format definition
/// </summary>
[JsonConverter(typeof(FormatConverter))]
public class Format
{
    /// <summary>
    /// Initializes a new instance of <see cref="Format"/>.
    /// </summary>
    public Format()
    {
    }

    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Whether the template can emit structural text for parsing output
    /// </summary>
    public bool? Strict { get; set; }

    /// <summary>
    /// Options for the template engine
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }

}

public class FormatConverter : JsonConverter<Format>
{
    public override Format Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Format.");
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new ArgumentException("Empty string shorthand values for Format are not supported");
            return new Format()
            {
                Kind = stringValue,
            };
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Format();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("strict", out JsonElement strictValue))
            {
                instance.Strict = strictValue.GetBoolean();
            }

            if (rootElement.TryGetProperty("options", out JsonElement optionsValue))
            {
                instance.Options = JsonSerializer.Deserialize<Dictionary<string, object>>(optionsValue.GetRawText(), options);
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Format value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Strict != null)
        {
            writer.WritePropertyName("strict");
            JsonSerializer.Serialize(writer, value.Strict, options);
        }

        if (value.Options != null)
        {
            writer.WritePropertyName("options");
            JsonSerializer.Serialize(writer, value.Options, options);
        }

        writer.WriteEndObject();
    }
}