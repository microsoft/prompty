// Copyright (c) Microsoft. All rights reserved.
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


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="ArrayParameter"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ArrayParameter Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ArrayParameter();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("items", out var itemsValue))
        {
            instance.Items = Parameter.Load(itemsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
    */
}


public class ArrayParameterConverter : JsonConverter<ArrayParameter>
{
    public override ArrayParameter Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ArrayParameter.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
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