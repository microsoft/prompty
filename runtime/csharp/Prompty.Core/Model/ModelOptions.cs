// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Options for configuring the behavior of the AI model.
/// `kind` is a required property here, but this section can accept additional via options.
/// </summary>
[JsonConverter(typeof(ModelOptionsConverter))]
public class ModelOptions
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
    public ModelOptions()
    {
    }

    /// <summary>
    /// 
    /// </summary>
    public string Kind { get; set; } = string.Empty;


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="ModelOptions"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static ModelOptions Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ModelOptions();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        return instance;
    }
    
    
    */
}


public class ModelOptionsConverter : JsonConverter<ModelOptions>
{
    public override ModelOptions Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ModelOptions.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ModelOptions();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ModelOptions value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WriteEndObject();
    }
}