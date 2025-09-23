// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Model for defining the structure and behavior of AI agents.
/// This model includes properties for specifying the model&#39;s provider, connection details, and various options.
/// It allows for flexible configuration of AI models to suit different use cases and requirements.
/// </summary>
[JsonConverter(typeof(ModelConverter))]
public class Model
{
    /// <summary>
    /// Initializes a new instance of <see cref="Model"/>.
    /// </summary>
    public Model()
    {
    }

    /// <summary>
    /// The unique identifier of the model - can be used as the single property shorthand
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// The provider of the model (e.g., 'openai', 'azure', 'anthropic')
    /// </summary>
    public string? Provider { get; set; }

    /// <summary>
    /// The connection configuration for the model
    /// </summary>
    public Connection? Connection { get; set; }

    /// <summary>
    /// Additional options for the model
    /// </summary>
    public ModelOptions? Options { get; set; }


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="Model"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Model Load(object props)
    {
        IDictionary<string, object> data;
        if (props is string stringValue)
        {
            data = new Dictionary<string, object>
            {
               {"id", stringValue}
            };
        }
        else
        {
            data = props.ToParamDictionary();
        }
        
        // create new instance
        var instance = new Model();
        
        if (data.TryGetValue("id", out var idValue))
        {
            instance.Id = idValue as string ?? throw new ArgumentException("Properties must contain a property named: id");
        }
        if (data.TryGetValue("provider", out var providerValue))
        {
            instance.Provider = providerValue as string;
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = ModelOptions.Load(optionsValue.ToParamDictionary());
        }
        return instance;
    }
    
    
    */
}


public class ModelConverter : JsonConverter<Model>
{
    public override Model Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Model.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Model();

            if (rootElement.TryGetProperty("id", out JsonElement idValue))
            {
                instance.Id = idValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: id");
            }

            if (rootElement.TryGetProperty("provider", out JsonElement providerValue))
            {
                instance.Provider = providerValue.GetString();
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection?>(connectionValue.GetRawText(), options);
            }

            if (rootElement.TryGetProperty("options", out JsonElement optionsValue))
            {
                instance.Options = JsonSerializer.Deserialize<ModelOptions?>(optionsValue.GetRawText(), options);
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Model value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("id");
        JsonSerializer.Serialize(writer, value.Id, options);

        if (value.Provider != null)
        {
            writer.WritePropertyName("provider");
            JsonSerializer.Serialize(writer, value.Provider, options);
        }

        if (value.Connection != null)
        {
            writer.WritePropertyName("connection");
            JsonSerializer.Serialize(writer, value.Connection, options);
        }

        if (value.Options != null)
        {
            writer.WritePropertyName("options");
            JsonSerializer.Serialize(writer, value.Options, options);
        }

        writer.WriteEndObject();
    }
}