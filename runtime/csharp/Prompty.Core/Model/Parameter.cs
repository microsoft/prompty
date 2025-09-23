// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a parameter for a tool.
/// </summary>
[JsonConverter(typeof(ParameterConverter))]
public class Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parameter"/>.
    /// </summary>
    public Parameter()
    {
    }

    /// <summary>
    /// Name of the parameter
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data type of the tool parameter
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the tool parameter is required
    /// </summary>
    public bool? Required { get; set; }

    /// <summary>
    /// Allowed enumeration values for the parameter
    /// </summary>
    public IList<object>? Enum { get; set; }

}

public class ParameterConverter : JsonConverter<Parameter>
{
    public override Parameter Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Parameter.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic Parameter instance
            Parameter instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for Parameter is not supported");
                instance = discriminator switch
                {
                    "object" => JsonSerializer.Deserialize<ObjectParameter>(rootElement, options)
                        ?? throw new JsonException("Empty ObjectParameter instances are not supported"),
                    "array" => JsonSerializer.Deserialize<ArrayParameter>(rootElement, options)
                        ?? throw new JsonException("Empty ArrayParameter instances are not supported"),
                    _ => new Parameter(),
                };
            }
            else
            {
                throw new JsonException("Missing Parameter discriminator property: 'kind'");
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

            if (rootElement.TryGetProperty("enum", out JsonElement enumValue))
            {
                instance.Enum = [.. enumValue.EnumerateArray().Select(x => x.GetScalarValue() ?? throw new ArgumentException("Empty array elements for enum are not supported"))];
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Parameter value, JsonSerializerOptions options)
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

        if (value.Enum != null)
        {
            writer.WritePropertyName("enum");
            JsonSerializer.Serialize(writer, value.Enum, options);
        }

        writer.WriteEndObject();
    }
}