// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The MCP Server tool.
/// </summary>
[JsonConverter(typeof(ModelToolConverter))]
public class ModelTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="ModelTool"/>.
    /// </summary>
    public ModelTool()
    {
    }

    /// <summary>
    /// The kind identifier for a model connection as a tool
    /// </summary>
    public override string Kind { get; set; } = "model";

    /// <summary>
    /// The connection configuration for the model tool
    /// </summary>
    public Model Model { get; set; }

}

public class ModelToolConverter : JsonConverter<ModelTool>
{
    public override ModelTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to ModelTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing ModelTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new ModelTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("model", out JsonElement modelValue))
            {
                instance.Model = JsonSerializer.Deserialize<Model>(modelValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: model");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, ModelTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("model");
        JsonSerializer.Serialize(writer, value.Model, options);

        writer.WriteEndObject();
    }
}