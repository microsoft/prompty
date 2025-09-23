// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a parameter for a tool.
/// </summary>
[JsonConverter(typeof(ParameterConverter))]
public class Parameter
{
    /// <summary>
    /// Initializes a new instance of <see cref="Parameter"/>.
    /// </summary>
    public Parameter()
    {
    }
        
    /// <summary>
    /// Name of the parameter
    /// </summary>
    public string Name { get; set; } = string.Empty;
        
    /// <summary>
    /// The data type of the tool parameter
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// A short description of the property
    /// </summary>
    public string? Description { get; set; }
        
    /// <summary>
    /// Whether the tool parameter is required
    /// </summary>
    public bool? Required { get; set; }
        
    /// <summary>
    /// Allowed enumeration values for the parameter
    /// </summary>
    public IList<object>? Enum { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Parameter"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Parameter Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Parameter instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("description", out var descriptionValue))
        {
            instance.Description = descriptionValue as string;
        }
        if (data.TryGetValue("required", out var requiredValue))
        {
            instance.Required = (bool)requiredValue;
        }
        if (data.TryGetValue("enum", out var enumValue))
        {
            instance.Enum = enumValue as IList<object>;
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Parameter"/> based on the "kind" property.
    /// </summary>
    internal static Parameter LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Parameter instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "object")
            {
                return ObjectParameter.Load(props);
            }
            else if (discriminator_value == "array")
            {
                return ArrayParameter.Load(props);
            }
            else
            {
                //create new instance (stop recursion)
                return new Parameter();
            }
        }
        else
        {
            throw new ArgumentException("Missing Parameter discriminator property: 'kind'");
        }
    }
    
}


public class ParameterConverter: JsonConverter<Parameter>
{
    public override Parameter Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new Parameter();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Parameter();
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = JsonSerializer.Deserialize<string>(nameValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = JsonSerializer.Deserialize<string?>(descriptionValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("required", out JsonElement requiredValue))
            {
                instance.Required = JsonSerializer.Deserialize<bool?>(requiredValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("enum", out JsonElement enumValue))
            {
                instance.Enum = JsonSerializer.Deserialize<IList<object>?>(enumValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return Parameter.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, Parameter value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Name != null)
        {
            writer.WritePropertyName("name");
            JsonSerializer.Serialize(writer, value.Name, options);
        }
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }
        if(value.Required != null)
        {
            writer.WritePropertyName("required");
            JsonSerializer.Serialize(writer, value.Required, options);
        }
        if(value.Enum != null)
        {
            writer.WritePropertyName("enum");
            JsonSerializer.Serialize(writer, value.Enum, options);
        }
        writer.WriteEndObject();
    }
}