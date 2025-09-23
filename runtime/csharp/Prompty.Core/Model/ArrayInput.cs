// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an array output property.
/// This extends the base Output model to represent an array of items.
/// </summary>
[JsonConverter(typeof(ArrayInputConverter))]
public class ArrayInput : Input
{
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayInput"/>.
    /// </summary>
    public ArrayInput()
    {
    }

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "array";

    /// <summary>
    /// The type of items contained in the array
    /// </summary>
    public Input Items { get; set; }


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayInput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ArrayInput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ArrayInput();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("items", out var itemsValue))
        {
            instance.Items = Input.Load(itemsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
    */
}


public class ArrayInputConverter : JsonConverter<ArrayInput>
{
    public override ArrayInput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ArrayInput.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ArrayInput();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("items", out JsonElement itemsValue))
            {
                instance.Items = JsonSerializer.Deserialize<Input>(itemsValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: items");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ArrayInput value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("items");
        JsonSerializer.Serialize(writer, value.Items, options);

        writer.WriteEndObject();
    }
}