// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The following represents a manifest that can be used to create agents dynamically.
/// It includes a list of models that the publisher of the manifest has tested and
/// has confidence will work with an instantiated prompt agent.
/// The manifest also includes parameters that can be used to configure the agent&#39;s behavior.
/// These parameters include values that can be used as publisher parameters that can
/// be used to describe additional variables that have been tested and are known to work.
/// 
/// Variables described here are then used to project into a prompt agent that can be executed.
/// Once parameters are provided, these can be referenced in the manifest using the following notation:
/// 
/// `${param:MyParameter}`
/// 
/// This allows for dynamic configuration of the agent based on the provided parameters.
/// (This notation is used elsewhere, but only the `param` scope is supported here)
/// </summary>
[JsonConverter(typeof(PromptyManifestConverter))]
public class PromptyManifest : PromptyBase
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyManifest"/>.
    /// </summary>
    public PromptyManifest()
    {
    }

    /// <summary>
    /// Type of agent, e.g., 'manifest'
    /// </summary>
    public override string Kind { get; set; } = "manifest";

    /// <summary>
    /// List of models that the agent can utilize
    /// </summary>
    public IList<Model> Models { get; set; } = [];

    /// <summary>
    /// Parameters for configuring the agent's behavior and execution
    /// </summary>
    public IList<Parameter> Parameters { get; set; } = [];

}

public class PromptyManifestConverter : JsonConverter<PromptyManifest>
{
    public override PromptyManifest Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to PromptyManifest.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing PromptyManifest: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new PromptyManifest();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("models", out JsonElement modelsValue))
            {
                if (modelsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Models =
                        [.. modelsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Model> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Models are not supported"))];
                }
                else if (modelsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Models =
                        [.. modelsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Model>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Models are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for models");
                }
            }

            if (rootElement.TryGetProperty("parameters", out JsonElement parametersValue))
            {
                if (parametersValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Parameter> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Parameters are not supported"))];
                }
                else if (parametersValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Parameter>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Parameters are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for parameters");
                }
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyManifest value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("models");
        JsonSerializer.Serialize(writer, value.Models, options);

        writer.WritePropertyName("parameters");
        JsonSerializer.Serialize(writer, value.Parameters, options);

        writer.WriteEndObject();
    }
}