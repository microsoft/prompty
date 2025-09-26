// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
/// It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
/// The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
/// available tools, and template configurations for prompt rendering.
/// 
/// These can be written in a markdown format or in a pure YAML format.
/// </summary>
[JsonConverter(typeof(PromptyConverter))]
public class Prompty : PromptyBase
{
    /// <summary>
    /// Initializes a new instance of <see cref="Prompty"/>.
    /// </summary>
    public Prompty()
    {
    }

    /// <summary>
    /// Type of agent, e.g., 'prompt'
    /// </summary>
    public string Kind { get; set; } = "prompt";

    /// <summary>
    /// Model configuration used for execution
    /// </summary>
    public Model Model { get; set; }

}

public class PromptyConverter : JsonConverter<Prompty>
{
    public override Prompty Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Prompty.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing Prompty: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Prompty();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("model", out JsonElement modelValue))
            {
                instance.Model = JsonSerializer.Deserialize<Model>(modelValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: model");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Prompty value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("model");
        JsonSerializer.Serialize(writer, value.Model, options);

        writer.WriteEndObject();
    }
}