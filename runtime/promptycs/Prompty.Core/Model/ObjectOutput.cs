// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an object output property.
/// This extends the base Output model to represent a structured object.
/// </summary>
[JsonConverter(typeof(ObjectOutputConverter))]
public class ObjectOutput : Output
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectOutput"/>.
    /// </summary>
    public ObjectOutput()
    {
    }
        
    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";
        
    /// <summary>
    /// The properties contained in the object
    /// </summary>
    public IList<Output> Properties { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="ObjectOutput"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ObjectOutput Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ObjectOutput();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("properties", out var propertiesValue))
        {
            instance.Properties = LoadProperties(propertiesValue);
        }
        return instance;
    }
    
    internal static IList<Output> LoadProperties(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Output.Load(item))];
    }
    
    
}


public class ObjectOutputConverter: JsonConverter<ObjectOutput>
{
    public override ObjectOutput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new ObjectOutput();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ObjectOutput();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("properties", out JsonElement propertiesValue))
            {
                instance.Properties = JsonSerializer.Deserialize<IList<Output>>(propertiesValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return ObjectOutput.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, ObjectOutput value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Properties != null)
        {
            writer.WritePropertyName("properties");
            JsonSerializer.Serialize(writer, value.Properties, options);
        }
        writer.WriteEndObject();
    }
}