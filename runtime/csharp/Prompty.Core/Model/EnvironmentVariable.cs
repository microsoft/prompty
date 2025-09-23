// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for an environment variable used in containerized agents.
/// </summary>
[JsonConverter(typeof(EnvironmentVariableConverter))]
public class EnvironmentVariable
{
    /// <summary>
    /// Initializes a new instance of <see cref="EnvironmentVariable"/>.
    /// </summary>
    public EnvironmentVariable()
    {
    }

    /// <summary>
    /// Name of the environment variable
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Environment variable resolution
    /// </summary>
    public string Value { get; set; } = string.Empty;


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="EnvironmentVariable"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static EnvironmentVariable Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new EnvironmentVariable();
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name");
        }
        if (data.TryGetValue("value", out var valueValue))
        {
            instance.Value = valueValue as string ?? throw new ArgumentException("Properties must contain a property named: value");
        }
        return instance;
    }
    
    
    */
}


public class EnvironmentVariableConverter : JsonConverter<EnvironmentVariable>
{
    public override EnvironmentVariable Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to EnvironmentVariable.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new EnvironmentVariable();

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("value", out JsonElement valueValue))
            {
                instance.Value = valueValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: value");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, EnvironmentVariable value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("value");
        JsonSerializer.Serialize(writer, value.Value, options);

        writer.WriteEndObject();
    }
}