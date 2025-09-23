// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for an Azure Container Registry (ACR).
/// </summary>
[JsonConverter(typeof(AzureContainerRegistryConverter))]
public class AzureContainerRegistry : Registry
{
    /// <summary>
    /// Initializes a new instance of <see cref="AzureContainerRegistry"/>.
    /// </summary>
    public AzureContainerRegistry()
    {
    }
        
    /// <summary>
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = "acr";
        
    /// <summary>
    /// The Azure subscription ID for the ACR
    /// </summary>
    public string Subscription { get; set; } = string.Empty;
        
    /// <summary>
    /// The Azure resource group containing the ACR
    /// </summary>
    public string ResourceGroup { get; set; } = string.Empty;
        
    /// <summary>
    /// The name of the ACR
    /// </summary>
    public string RegistryName { get; set; } = string.Empty;
    

    /// <summary>
    /// Initializes a new instance of <see cref="AzureContainerRegistry"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new AzureContainerRegistry Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new AzureContainerRegistry();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("subscription", out var subscriptionValue))
        {
            instance.Subscription = subscriptionValue as string ?? throw new ArgumentException("Properties must contain a property named: subscription", nameof(props));
        }
        if (data.TryGetValue("resourceGroup", out var resourceGroupValue))
        {
            instance.ResourceGroup = resourceGroupValue as string ?? throw new ArgumentException("Properties must contain a property named: resourceGroup", nameof(props));
        }
        if (data.TryGetValue("registryName", out var registryNameValue))
        {
            instance.RegistryName = registryNameValue as string ?? throw new ArgumentException("Properties must contain a property named: registryName", nameof(props));
        }
        return instance;
    }
    
    
}


public class AzureContainerRegistryConverter: JsonConverter<AzureContainerRegistry>
{
    public override AzureContainerRegistry Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new AzureContainerRegistry();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new AzureContainerRegistry();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("subscription", out JsonElement subscriptionValue))
            {
                instance.Subscription = JsonSerializer.Deserialize<string>(subscriptionValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("resourceGroup", out JsonElement resourceGroupValue))
            {
                instance.ResourceGroup = JsonSerializer.Deserialize<string>(resourceGroupValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("registryName", out JsonElement registryNameValue))
            {
                instance.RegistryName = JsonSerializer.Deserialize<string>(registryNameValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return AzureContainerRegistry.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, AzureContainerRegistry value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Subscription != null)
        {
            writer.WritePropertyName("subscription");
            JsonSerializer.Serialize(writer, value.Subscription, options);
        }
        if(value.ResourceGroup != null)
        {
            writer.WritePropertyName("resourceGroup");
            JsonSerializer.Serialize(writer, value.ResourceGroup, options);
        }
        if(value.RegistryName != null)
        {
            writer.WritePropertyName("registryName");
            JsonSerializer.Serialize(writer, value.RegistryName, options);
        }
        writer.WriteEndObject();
    }
}