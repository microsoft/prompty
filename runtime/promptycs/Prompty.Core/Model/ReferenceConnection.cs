// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using named connections.
/// </summary>
[JsonConverter(typeof(ReferenceConnectionConverter))]
public class ReferenceConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
    public ReferenceConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "reference";
        
    /// <summary>
    /// The name of the connection
    /// </summary>
    public string Name { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="ReferenceConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ReferenceConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ReferenceConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        return instance;
    }
    
    
}


public class ReferenceConnectionConverter: JsonConverter<ReferenceConnection>
{
    public override ReferenceConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new ReferenceConnection();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ReferenceConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = JsonSerializer.Deserialize<string>(nameValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return ReferenceConnection.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, ReferenceConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Name != null)
        {
            writer.WritePropertyName("name");
            JsonSerializer.Serialize(writer, value.Name, options);
        }
        writer.WriteEndObject();
    }
}