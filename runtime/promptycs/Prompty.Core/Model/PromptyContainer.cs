// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// 
/// </summary>
[JsonConverter(typeof(PromptyContainerConverter))]
public class PromptyContainer : Prompty
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
    public PromptyContainer()
    {
    }
        
    /// <summary>
    /// Type of agent, e.g., 'prompt' or 'container'
    /// </summary>
    public override string Kind { get; set; } = "container";
        
    /// <summary>
    /// Protocol used by the containerized agent
    /// </summary>
    public string Protocol { get; set; } = "responses";
        
    /// <summary>
    /// Container definition including registry and scaling information
    /// </summary>
    public ContainerDefinition Container { get; set; }
        
    /// <summary>
    /// Environment variables to set in the hosted agent container.
    /// </summary>
    public IList<EnvironmentVariable>? EnvironmentVariables { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new PromptyContainer Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new PromptyContainer();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("protocol", out var protocolValue))
        {
            instance.Protocol = protocolValue as string ?? throw new ArgumentException("Properties must contain a property named: protocol", nameof(props));
        }
        if (data.TryGetValue("container", out var containerValue))
        {
            instance.Container = ContainerDefinition.Load(containerValue.ToParamDictionary());
        }
        if (data.TryGetValue("environmentVariables", out var environmentVariablesValue))
        {
            instance.EnvironmentVariables = LoadEnvironmentVariables(environmentVariablesValue);
        }
        return instance;
    }
    
    internal static IList<EnvironmentVariable> LoadEnvironmentVariables(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => EnvironmentVariable.Load(item))];
    }
    
    
}


public class PromptyContainerConverter: JsonConverter<PromptyContainer>
{
    public override PromptyContainer Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new PromptyContainer();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new PromptyContainer();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("protocol", out JsonElement protocolValue))
            {
                instance.Protocol = JsonSerializer.Deserialize<string>(protocolValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("container", out JsonElement containerValue))
            {
                instance.Container = JsonSerializer.Deserialize<ContainerDefinition>(containerValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("environmentVariables", out JsonElement environmentVariablesValue))
            {
                instance.EnvironmentVariables = JsonSerializer.Deserialize<IList<EnvironmentVariable>?>(environmentVariablesValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return PromptyContainer.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyContainer value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Protocol != null)
        {
            writer.WritePropertyName("protocol");
            JsonSerializer.Serialize(writer, value.Protocol, options);
        }
        if(value.Container != null)
        {
            writer.WritePropertyName("container");
            JsonSerializer.Serialize(writer, value.Container, options);
        }
        if(value.EnvironmentVariables != null)
        {
            writer.WritePropertyName("environmentVariables");
            JsonSerializer.Serialize(writer, value.EnvironmentVariables, options);
        }
        writer.WriteEndObject();
    }
}