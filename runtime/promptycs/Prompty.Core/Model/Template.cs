// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template model for defining prompt templates.
/// 
/// This model specifies the rendering engine used for slot filling prompts,
/// the parser used to process the rendered template into API-compatible format,
/// and additional options for the template engine.
/// 
/// It allows for the creation of reusable templates that can be filled with dynamic data
/// and processed to generate prompts for AI models.
/// </summary>
[JsonConverter(typeof(TemplateConverter))]
public class Template
{
    /// <summary>
    /// Initializes a new instance of <see cref="Template"/>.
    /// </summary>
    public Template()
    {
    }
        
    /// <summary>
    /// Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)
    /// </summary>
    public Format Format { get; set; }
        
    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public Parser Parser { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Template"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Template Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Template();
        
        if (data.TryGetValue("format", out var formatValue))
        {
            instance.Format = Format.Load(formatValue.ToParamDictionary());
        }
        if (data.TryGetValue("parser", out var parserValue))
        {
            instance.Parser = Parser.Load(parserValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}


public class TemplateConverter: JsonConverter<Template>
{
    public override Template Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new Template();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Template();
            if (rootElement.TryGetProperty("format", out JsonElement formatValue))
            {
                instance.Format = JsonSerializer.Deserialize<Format>(formatValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("parser", out JsonElement parserValue))
            {
                instance.Parser = JsonSerializer.Deserialize<Parser>(parserValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return Template.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, Template value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Format != null)
        {
            writer.WritePropertyName("format");
            JsonSerializer.Serialize(writer, value.Format, options);
        }
        if(value.Parser != null)
        {
            writer.WritePropertyName("parser");
            JsonSerializer.Serialize(writer, value.Parser, options);
        }
        writer.WriteEndObject();
    }
}