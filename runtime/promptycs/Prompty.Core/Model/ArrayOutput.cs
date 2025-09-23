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
    

    /// <summary>
    /// Initializes a new instance of <see cref="ArrayOutput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ArrayOutput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ArrayOutput();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("items", out var itemsValue))
        {
            instance.Items = Output.Load(itemsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}


public class ArrayOutputConverter: JsonConverter<ArrayOutput>
{
    public override ArrayOutput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new ArrayOutput();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ArrayOutput();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("items", out JsonElement itemsValue))
            {
                instance.Items = JsonSerializer.Deserialize<Output>(itemsValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return ArrayOutput.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, ArrayOutput value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Items != null)
        {
            writer.WritePropertyName("items");
            JsonSerializer.Serialize(writer, value.Items, options);
        }
        writer.WriteEndObject();
    }
}