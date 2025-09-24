// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an array output property.
/// This extends the base Output model to represent an array of items.
/// </summary>
[JsonConverter(typeof(ArrayOutputConverter))]
public class ArrayOutput : Output
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayOutput"/>.
    /// </summary>
    public ArrayOutput()
    {
    }

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";

    /// <summary>
    /// The type of items contained in the array
    /// </summary>
    public Output Items { get; set; }

}

public class ArrayOutputConverter : JsonConverter<ArrayOutput>
{
    public override ArrayOutput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ArrayOutput.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing ArrayOutput: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ArrayOutput();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("items", out JsonElement itemsValue))
            {
                instance.Items = JsonSerializer.Deserialize<Output>(itemsValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: items");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ArrayOutput value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("items");
        JsonSerializer.Serialize(writer, value.Items, options);

        writer.WriteEndObject();
    }
}