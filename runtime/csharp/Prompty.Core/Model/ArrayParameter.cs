// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an array parameter for a tool.
/// </summary>
[JsonConverter(typeof(ArrayParameterConverter))]
public class ArrayParameter : Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayParameter"/>.
    /// </summary>
    public ArrayParameter()
    {
    }

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";

    /// <summary>
    /// The kind of items contained in the array
    /// </summary>
    public Parameter Items { get; set; }

}

public class ArrayParameterConverter : JsonConverter<ArrayParameter>
{
    public override ArrayParameter Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ArrayParameter.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing ArrayParameter: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ArrayParameter();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("items", out JsonElement itemsValue))
            {
                instance.Items = JsonSerializer.Deserialize<Parameter>(itemsValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: items");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ArrayParameter value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("items");
        JsonSerializer.Serialize(writer, value.Items, options);

        writer.WriteEndObject();
    }
}