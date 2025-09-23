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

}

public class ScaleConverter : JsonConverter<Scale>
{
    public override Scale Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Scale.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new Scale();
            if (rootElement.TryGetProperty("minReplicas", out JsonElement minReplicasValue))
            {
                instance.MinReplicas = minReplicasValue.GetInt32();
            }

            if (rootElement.TryGetProperty("maxReplicas", out JsonElement maxReplicasValue))
            {
                instance.MaxReplicas = maxReplicasValue.GetInt32();
            }

            if (rootElement.TryGetProperty("cpu", out JsonElement cpuValue))
            {
                instance.Cpu = cpuValue.GetSingle();
            }

            if (rootElement.TryGetProperty("memory", out JsonElement memoryValue))
            {
                instance.Memory = memoryValue.GetSingle();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Scale value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if (value.MinReplicas != null)
        {
            writer.WritePropertyName("minReplicas");
            JsonSerializer.Serialize(writer, value.MinReplicas, options);
        }

        if (value.MaxReplicas != null)
        {
            writer.WritePropertyName("maxReplicas");
            JsonSerializer.Serialize(writer, value.MaxReplicas, options);
        }

        writer.WritePropertyName("cpu");
        JsonSerializer.Serialize(writer, value.Cpu, options);

        writer.WritePropertyName("memory");
        JsonSerializer.Serialize(writer, value.Memory, options);

        writer.WriteEndObject();
    }
}