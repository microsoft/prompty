// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Template parser definition
/// </summary>
[JsonConverter(typeof(ParserConverter))]
public class Parser
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
    public Parser()
    {
    }
        
    /// <summary>
    /// Parser used to process the rendered template into API-compatible format
    /// </summary>
    public string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// Options for the parser
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Parser"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Parser Load(object props)
    {
        IDictionary<string, object> data;
        if (props is string stringValue)
        {
            data = new Dictionary<string, object>
            {
               {"kind", stringValue}
            };
        }
        else
        {
            data = props.ToParamDictionary();
        }
        
        // create new instance
        var instance = new Parser();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object>;
        }
        return instance;
    }
    
    
}


public class ParserConverter: JsonConverter<Parser>
{
    public override Parser Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new Parser();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Parser();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("options", out JsonElement optionsValue))
            {
                instance.Options = JsonSerializer.Deserialize<IDictionary<string, object>?>(optionsValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return Parser.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, Parser value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Options != null)
        {
            writer.WritePropertyName("options");
            JsonSerializer.Serialize(writer, value.Options, options);
        }
        writer.WriteEndObject();
    }
}