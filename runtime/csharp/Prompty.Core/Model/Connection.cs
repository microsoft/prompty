// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI agents.
/// `provider`, `kind`, and `endpoint` are required properties here,
/// but this section can accept additional via options.
/// </summary>
[JsonConverter(typeof(ConnectionConverter))]
public abstract class Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
    protected Connection()
    {
    }

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')
    /// </summary>
    public string Authority { get; set; } = "system";

    /// <summary>
    /// The usage description for the connection, providing context on how this connection will be used
    /// </summary>
    public string? UsageDescription { get; set; }


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Connection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Connection instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("authority", out var authorityValue))
        {
            instance.Authority = authorityValue as string ?? throw new ArgumentException("Properties must contain a property named: authority");
        }
        if (data.TryGetValue("usageDescription", out var usageDescriptionValue))
        {
            instance.UsageDescription = usageDescriptionValue as string;
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Connection"/> based on the "kind" property.
    /// </summary>
    internal static Connection LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Connection instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "reference")
            {
                return ReferenceConnection.Load(props);
            }
            else if (discriminator_value == "key")
            {
                return KeyConnection.Load(props);
            }
            else if (discriminator_value == "oauth")
            {
                return OAuthConnection.Load(props);
            }
            else if (discriminator_value == "foundry")
            {
                return FoundryConnection.Load(props);
            }
            else
            {
                
                // load default instance
                return GenericConnection.Load(props);
                
            }
        }
        else
        {
            throw new ArgumentException("Missing Connection discriminator property: 'kind'");
        }
    }
    
    */
}




public class ConnectionConverter : JsonConverter<Connection>
{
    public override Connection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Connection.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new GenericConnection();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("authority", out JsonElement authorityValue))
            {
                instance.Authority = authorityValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: authority");
            }

            if (rootElement.TryGetProperty("usageDescription", out JsonElement usageDescriptionValue))
            {
                instance.UsageDescription = usageDescriptionValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Connection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("authority");
        JsonSerializer.Serialize(writer, value.Authority, options);

        if (value.UsageDescription != null)
        {
            writer.WritePropertyName("usageDescription");
            JsonSerializer.Serialize(writer, value.UsageDescription, options);
        }

        writer.WriteEndObject();
    }
}