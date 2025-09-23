// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a binding between an input property and a tool parameter.
/// </summary>
[JsonConverter(typeof(BindingConverter))]
public class Binding
{
    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
    public Binding()
    {
    }
        
    /// <summary>
    /// Name of the binding
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The input property that will be bound to the tool parameter argument
    /// </summary>
    public string Input { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="Binding"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Binding Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Binding();
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("input", out var inputValue))
        {
            instance.Input = inputValue as string ?? throw new ArgumentException("Properties must contain a property named: input", nameof(props));
        }
        return instance;
    }
    
    
}


public class BindingConverter: JsonConverter<Binding>
{
    public override Binding Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new Binding();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Binding();
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = JsonSerializer.Deserialize<string>(nameValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("input", out JsonElement inputValue))
            {
                instance.Input = JsonSerializer.Deserialize<string>(inputValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return Binding.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, Binding value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Name != null)
        {
            writer.WritePropertyName("name");
            JsonSerializer.Serialize(writer, value.Name, options);
        }
        if(value.Input != null)
        {
            writer.WritePropertyName("input");
            JsonSerializer.Serialize(writer, value.Input, options);
        }
        writer.WriteEndObject();
    }
}