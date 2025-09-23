// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for a generic container image registry.
/// </summary>
[JsonConverter(typeof(GenericRegistryConverter))]
public class GenericRegistry : Registry
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericRegistry"/>.
    /// </summary>
    public GenericRegistry()
    {
    }

    /// <summary>
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The URL of the container registry
    /// </summary>
    public string Repository { get; set; } = string.Empty;

    /// <summary>
    /// The username for accessing the container registry
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// The password for accessing the container registry
    /// </summary>
    public string? Password { get; set; }


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="GenericRegistry"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new GenericRegistry Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new GenericRegistry();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("repository", out var repositoryValue))
        {
            instance.Repository = repositoryValue as string ?? throw new ArgumentException("Properties must contain a property named: repository");
        }
        if (data.TryGetValue("username", out var usernameValue))
        {
            instance.Username = usernameValue as string;
        }
        if (data.TryGetValue("password", out var passwordValue))
        {
            instance.Password = passwordValue as string;
        }
        return instance;
    }
    
    
    */
}


public class GenericRegistryConverter : JsonConverter<GenericRegistry>
{
    public override GenericRegistry Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to GenericRegistry.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new GenericRegistry();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("repository", out JsonElement repositoryValue))
            {
                instance.Repository = repositoryValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: repository");
            }

            if (rootElement.TryGetProperty("username", out JsonElement usernameValue))
            {
                instance.Username = usernameValue.GetString();
            }

            if (rootElement.TryGetProperty("password", out JsonElement passwordValue))
            {
                instance.Password = passwordValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, GenericRegistry value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("repository");
        JsonSerializer.Serialize(writer, value.Repository, options);

        if (value.Username != null)
        {
            writer.WritePropertyName("username");
            JsonSerializer.Serialize(writer, value.Username, options);
        }

        if (value.Password != null)
        {
            writer.WritePropertyName("password");
            JsonSerializer.Serialize(writer, value.Password, options);
        }

        writer.WriteEndObject();
    }
}