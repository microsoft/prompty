// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents an object parameter for a tool.
/// </summary>
[JsonConverter(typeof(ObjectParameterConverter))]
public class ObjectParameter : Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectParameter"/>.
    /// </summary>
    public ObjectParameter()
    {
    }

    /// <summary>
    /// 
    /// </summary>
    public override string Kind { get; set; } = "object";

    /// <summary>
    /// The properties of the object parameter
    /// </summary>
    public IList<Parameter> Properties { get; set; } = [];


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="ObjectParameter"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ObjectParameter Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ObjectParameter();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("properties", out var propertiesValue))
        {
            instance.Properties = LoadProperties(propertiesValue);
        }
        return instance;
    }
    
    internal static IList<Parameter> LoadProperties(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Parameter.Load(item))];
    }
    
    
    */
}


public class ObjectParameterConverter : JsonConverter<ObjectParameter>
{
    public override ObjectParameter Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ObjectParameter.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ObjectParameter();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("properties", out JsonElement propertiesValue))
            {
                // need object collection deserialization
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ObjectParameter value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("properties");
        JsonSerializer.Serialize(writer, value.Properties, options);

        writer.WriteEndObject();
    }
}