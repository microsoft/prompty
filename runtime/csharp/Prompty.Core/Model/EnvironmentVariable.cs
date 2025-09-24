// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for an environment variable used in containerized agents.
/// </summary>
[JsonConverter(typeof(EnvironmentVariableConverter))]
public class EnvironmentVariable
{
    /// <summary>
    /// Initializes a new instance of <see cref="EnvironmentVariable"/>.
    /// </summary>
    public EnvironmentVariable()
    {
    }

    /// <summary>
    /// Name of the environment variable
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Environment variable resolution
    /// </summary>
    public string Value { get; set; } = string.Empty;

}

public class EnvironmentVariableConverter : JsonConverter<EnvironmentVariable>
{
    public override EnvironmentVariable Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to EnvironmentVariable.");
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new JsonException("Empty string shorthand values for EnvironmentVariable are not supported");
            return new EnvironmentVariable()
            {
                Value = stringValue,
            };
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing EnvironmentVariable: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new EnvironmentVariable();
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("value", out JsonElement valueValue))
            {
                instance.Value = valueValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: value");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, EnvironmentVariable value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("value");
        JsonSerializer.Serialize(writer, value.Value, options);

        writer.WriteEndObject();
    }
}