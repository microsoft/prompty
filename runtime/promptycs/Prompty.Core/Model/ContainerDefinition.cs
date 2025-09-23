// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for a containerized AI agent.
/// </summary>
[JsonConverter(typeof(ContainerDefinitionConverter))]
public class ContainerDefinition
{
    /// <summary>
    /// Initializes a new instance of <see cref="ContainerDefinition"/>.
    /// </summary>
    public ContainerDefinition()
    {
    }
        
    /// <summary>
    /// The container image name
    /// </summary>
    public string Image { get; set; } = string.Empty;
        
    /// <summary>
    /// The container image tag (defaults to 'latest' if not specified)
    /// </summary>
    public string? Tag { get; set; }
        
    /// <summary>
    /// Container image registry definition
    /// </summary>
    public Registry Registry { get; set; }
        
    /// <summary>
    /// Instance scaling configuration
    /// </summary>
    public Scale Scale { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="ContainerDefinition"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static ContainerDefinition Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ContainerDefinition();
        
        if (data.TryGetValue("image", out var imageValue))
        {
            instance.Image = imageValue as string ?? throw new ArgumentException("Properties must contain a property named: image", nameof(props));
        }
        if (data.TryGetValue("tag", out var tagValue))
        {
            instance.Tag = tagValue as string;
        }
        if (data.TryGetValue("registry", out var registryValue))
        {
            instance.Registry = Registry.Load(registryValue.ToParamDictionary());
        }
        if (data.TryGetValue("scale", out var scaleValue))
        {
            instance.Scale = Scale.Load(scaleValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}


public class ContainerDefinitionConverter: JsonConverter<ContainerDefinition>
{
    public override ContainerDefinition Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new ContainerDefinition();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ContainerDefinition();
            if (rootElement.TryGetProperty("image", out JsonElement imageValue))
            {
                instance.Image = JsonSerializer.Deserialize<string>(imageValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("tag", out JsonElement tagValue))
            {
                instance.Tag = JsonSerializer.Deserialize<string?>(tagValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("registry", out JsonElement registryValue))
            {
                instance.Registry = JsonSerializer.Deserialize<Registry>(registryValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("scale", out JsonElement scaleValue))
            {
                instance.Scale = JsonSerializer.Deserialize<Scale>(scaleValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return ContainerDefinition.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, ContainerDefinition value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Image != null)
        {
            writer.WritePropertyName("image");
            JsonSerializer.Serialize(writer, value.Image, options);
        }
        if(value.Tag != null)
        {
            writer.WritePropertyName("tag");
            JsonSerializer.Serialize(writer, value.Tag, options);
        }
        if(value.Registry != null)
        {
            writer.WritePropertyName("registry");
            JsonSerializer.Serialize(writer, value.Registry, options);
        }
        if(value.Scale != null)
        {
            writer.WritePropertyName("scale");
            JsonSerializer.Serialize(writer, value.Scale, options);
        }
        writer.WriteEndObject();
    }
}