// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// 
/// </summary>
[JsonConverter(typeof(FoundryConnectionConverter))]
public class FoundryConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
    public FoundryConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "foundry";
        
    /// <summary>
    /// The Foundry endpoint URL for the AI service
    /// </summary>
    public string Type { get; set; } = string.Empty;
        
    /// <summary>
    /// The Foundry connection name
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The Foundry project name
    /// </summary>
    public string Project { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="FoundryConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FoundryConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FoundryConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("type", out var typeValue))
        {
            instance.Type = typeValue as string ?? throw new ArgumentException("Properties must contain a property named: type", nameof(props));
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("project", out var projectValue))
        {
            instance.Project = projectValue as string ?? throw new ArgumentException("Properties must contain a property named: project", nameof(props));
        }
        return instance;
    }
    
    
}


public class FoundryConnectionConverter: JsonConverter<FoundryConnection>
{
    public override FoundryConnection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new FoundryConnection();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new FoundryConnection();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("type", out JsonElement typeValue))
            {
                instance.Type = JsonSerializer.Deserialize<string>(typeValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = JsonSerializer.Deserialize<string>(nameValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("project", out JsonElement projectValue))
            {
                instance.Project = JsonSerializer.Deserialize<string>(projectValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return FoundryConnection.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, FoundryConnection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Type != null)
        {
            writer.WritePropertyName("type");
            JsonSerializer.Serialize(writer, value.Type, options);
        }
        if(value.Name != null)
        {
            writer.WritePropertyName("name");
            JsonSerializer.Serialize(writer, value.Name, options);
        }
        if(value.Project != null)
        {
            writer.WritePropertyName("project");
            JsonSerializer.Serialize(writer, value.Project, options);
        }
        writer.WriteEndObject();
    }
}