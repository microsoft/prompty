// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a single input property for a prompt.
/// * This model defines the structure of input properties that can be used in prompts,
/// including their type, description, whether they are required, and other attributes.
/// * It allows for the definition of dynamic inputs that can be filled with data
/// and processed to generate prompts for AI models.
/// </summary>
[JsonConverter(typeof(InputConverter))]
public class Input
{
    /// <summary>
    /// Initializes a new instance of <see cref="Input"/>.
    /// </summary>
    public Input()
    {
    }

    /// <summary>
    /// Name of the input property
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data type of the input property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the input property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the input property is required
    /// </summary>
    public bool? Required { get; set; }

    /// <summary>
    /// Whether the input property can emit structural text when parsing output
    /// </summary>
    public bool? Strict { get; set; }

    /// <summary>
    /// The default value of the input - this represents the default value if none is provided
    /// </summary>
    public object? Default { get; set; }

    /// <summary>
    /// A sample value of the input for examples and tooling
    /// </summary>
    public object? Sample { get; set; }

}

public class InputConverter : JsonConverter<Input>
{
    public override Input Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Input.");
        }
        else if (reader.TokenType == JsonTokenType.True || reader.TokenType == JsonTokenType.False)
        {
            var boolValue = reader.GetBoolean();
            return new Input()
            {
                Kind = "boolean",
                Sample = boolValue,
            };
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            var floatValue = reader.GetSingle();
            return new Input()
            {
                Kind = "float",
                Sample = floatValue,
            };
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            var intValue = reader.GetInt32();
            return new Input()
            {
                Kind = "integer",
                Sample = intValue,
            };
        }
        else if (reader.TokenType == JsonTokenType.String)
        {
            var stringValue = reader.GetString() ?? throw new ArgumentException("Empty string shorthand values for Input are not supported");
            return new Input()
            {
                Kind = "string",
                Sample = stringValue,
            };
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic Input instance
            Input instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for Input is not supported");
                instance = discriminator switch
                {
                    "array" => JsonSerializer.Deserialize<ArrayInput>(rootElement, options)
                        ?? throw new JsonException("Empty ArrayInput instances are not supported"),
                    "object" => JsonSerializer.Deserialize<ObjectInput>(rootElement, options)
                        ?? throw new JsonException("Empty ObjectInput instances are not supported"),
                    _ => new Input(),
                };
            }
            else
            {
                throw new JsonException("Missing Input discriminator property: 'kind'");
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = descriptionValue.GetString();
            }

            if (rootElement.TryGetProperty("required", out JsonElement requiredValue))
            {
                instance.Required = requiredValue.GetBoolean();
            }

            if (rootElement.TryGetProperty("strict", out JsonElement strictValue))
            {
                instance.Strict = strictValue.GetBoolean();
            }

            if (rootElement.TryGetProperty("default", out JsonElement defaultValue))
            {
                instance.Default = defaultValue.GetScalarValue();
            }

            if (rootElement.TryGetProperty("sample", out JsonElement sampleValue))
            {
                instance.Sample = sampleValue.GetScalarValue();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Input value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }

        if (value.Required != null)
        {
            writer.WritePropertyName("required");
            JsonSerializer.Serialize(writer, value.Required, options);
        }

        if (value.Strict != null)
        {
            writer.WritePropertyName("strict");
            JsonSerializer.Serialize(writer, value.Strict, options);
        }

        if (value.Default != null)
        {
            writer.WritePropertyName("default");
            JsonSerializer.Serialize(writer, value.Default, options);
        }

        if (value.Sample != null)
        {
            writer.WritePropertyName("sample");
            JsonSerializer.Serialize(writer, value.Sample, options);
        }

        writer.WriteEndObject();
    }
}