// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents the output properties of an AI agent.
/// Each output property can be a simple kind, an array, or an object.
/// </summary>
[JsonConverter(typeof(OutputConverter))]
public class Output
{
    /// <summary>
    /// Initializes a new instance of <see cref="Output"/>.
    /// </summary>
    public Output()
    {
    }

    /// <summary>
    /// Name of the output property
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The data kind of the output property
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the output property
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Whether the output property is required
    /// </summary>
    public bool? Required { get; set; }


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="Output"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Output Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Output instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name");
        }
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("description", out var descriptionValue))
        {
            instance.Description = descriptionValue as string;
        }
        if (data.TryGetValue("required", out var requiredValue))
        {
            instance.Required = (bool)requiredValue;
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Output"/> based on the "kind" property.
    /// </summary>
    internal static Output LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Output instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "array")
            {
                return ArrayOutput.Load(props);
            }
            else if (discriminator_value == "object")
            {
                return ObjectOutput.Load(props);
            }
            else
            {
                //create new instance (stop recursion)
                return new Output();
            }
        }
        else
        {
            throw new ArgumentException("Missing Output discriminator property: 'kind'");
        }
    }
    
    */
}


public class OutputConverter : JsonConverter<Output>
{
    public override Output Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Output.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Output();

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = descriptionValue.GetString();
            }

            if (rootElement.TryGetProperty("required", out JsonElement requiredValue))
            {
                instance.Required = requiredValue.GetBoolean();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Output value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }

        if (value.Required != null)
        {
            writer.WritePropertyName("required");
            JsonSerializer.Serialize(writer, value.Required, options);
        }

        writer.WriteEndObject();
    }
}