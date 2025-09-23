// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Configuration for scaling container instances.
/// </summary>
[JsonConverter(typeof(ScaleConverter))]
public class Scale
{
    /// <summary>
    /// Initializes a new instance of <see cref="Scale"/>.
    /// </summary>
    public Scale()
    {
    }
        
    /// <summary>
    /// Minimum number of container instances to run
    /// </summary>
    public int? MinReplicas { get; set; }
        
    /// <summary>
    /// Maximum number of container instances to run
    /// </summary>
    public int? MaxReplicas { get; set; }
        
    /// <summary>
    /// CPU allocation per instance (in cores)
    /// </summary>
    public float Cpu { get; set; }
        
    /// <summary>
    /// Memory allocation per instance (in GB)
    /// </summary>
    public float Memory { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Scale"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Scale Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new Scale();
        
        if (data.TryGetValue("minReplicas", out var minReplicasValue))
        {
            instance.MinReplicas = (int)minReplicasValue;
        }
        if (data.TryGetValue("maxReplicas", out var maxReplicasValue))
        {
            instance.MaxReplicas = (int)maxReplicasValue;
        }
        if (data.TryGetValue("cpu", out var cpuValue))
        {
            instance.Cpu = (float)cpuValue;
        }
        if (data.TryGetValue("memory", out var memoryValue))
        {
            instance.Memory = (float)memoryValue;
        }
        return instance;
    }
    
    
}


public class ScaleConverter: JsonConverter<Scale>
{
    public override Scale Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new Scale();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new Scale();
            if (rootElement.TryGetProperty("minReplicas", out JsonElement minReplicasValue))
            {
                instance.MinReplicas = JsonSerializer.Deserialize<int?>(minReplicasValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("maxReplicas", out JsonElement maxReplicasValue))
            {
                instance.MaxReplicas = JsonSerializer.Deserialize<int?>(maxReplicasValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("cpu", out JsonElement cpuValue))
            {
                instance.Cpu = JsonSerializer.Deserialize<float>(cpuValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("memory", out JsonElement memoryValue))
            {
                instance.Memory = JsonSerializer.Deserialize<float>(memoryValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return Scale.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, Scale value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.MinReplicas != null)
        {
            writer.WritePropertyName("minReplicas");
            JsonSerializer.Serialize(writer, value.MinReplicas, options);
        }
        if(value.MaxReplicas != null)
        {
            writer.WritePropertyName("maxReplicas");
            JsonSerializer.Serialize(writer, value.MaxReplicas, options);
        }
        if(value.Cpu != null)
        {
            writer.WritePropertyName("cpu");
            JsonSerializer.Serialize(writer, value.Cpu, options);
        }
        if(value.Memory != null)
        {
            writer.WritePropertyName("memory");
            JsonSerializer.Serialize(writer, value.Memory, options);
        }
        writer.WriteEndObject();
    }
}