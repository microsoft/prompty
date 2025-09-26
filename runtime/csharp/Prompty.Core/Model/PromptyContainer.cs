// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// 
/// </summary>
[JsonConverter(typeof(PromptyContainerConverter))]
public class PromptyContainer : PromptyBase
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyContainer"/>.
    /// </summary>
    public PromptyContainer()
    {
    }

    /// <summary>
    /// Type of agent, e.g., 'container'
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

}

public class PromptyContainerConverter : JsonConverter<PromptyContainer>
{
    public override PromptyContainer Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to PromptyContainer.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing PromptyContainer: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new PromptyContainer();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("protocol", out JsonElement protocolValue))
            {
                instance.Protocol = protocolValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: protocol");
            }

            if (rootElement.TryGetProperty("container", out JsonElement containerValue))
            {
                instance.Container = JsonSerializer.Deserialize<ContainerDefinition>(containerValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: container");
            }

            if (rootElement.TryGetProperty("environmentVariables", out JsonElement environmentVariablesValue))
            {
                if (environmentVariablesValue.ValueKind == JsonValueKind.Array)
                {
                    instance.EnvironmentVariables =
                        [.. environmentVariablesValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<EnvironmentVariable> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for EnvironmentVariables are not supported"))];
                }
                else if (environmentVariablesValue.ValueKind == JsonValueKind.Object)
                {
                    instance.EnvironmentVariables =
                        [.. environmentVariablesValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<EnvironmentVariable>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for EnvironmentVariables are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for environmentVariables");
                }
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyContainer value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("protocol");
        JsonSerializer.Serialize(writer, value.Protocol, options);

        writer.WritePropertyName("container");
        JsonSerializer.Serialize(writer, value.Container, options);

        if (value.EnvironmentVariables != null)
        {
            writer.WritePropertyName("environmentVariables");
            JsonSerializer.Serialize(writer, value.EnvironmentVariables, options);
        }

        writer.WriteEndObject();
    }
}