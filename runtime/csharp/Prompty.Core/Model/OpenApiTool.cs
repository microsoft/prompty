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
[JsonConverter(typeof(OpenApiToolConverter))]
public class OpenApiTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="OpenApiTool"/>.
    /// </summary>
    public OpenApiTool()
    {
    }

    /// <summary>
    /// The kind identifier for OpenAPI tools
    /// </summary>
    public override string Kind { get; set; } = "openapi";

    /// <summary>
    /// The connection configuration for the OpenAPI tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The URL or relative path to the OpenAPI specification document (JSON or YAML format)
    /// </summary>
    public string Specification { get; set; } = string.Empty;

}

public class OpenApiToolConverter : JsonConverter<OpenApiTool>
{
    public override OpenApiTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to OpenApiTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing OpenApiTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new OpenApiTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: connection");
            }

            if (rootElement.TryGetProperty("specification", out JsonElement specificationValue))
            {
                instance.Specification = specificationValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: specification");
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, OpenApiTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("connection");
        JsonSerializer.Serialize(writer, value.Connection, options);

        writer.WritePropertyName("specification");
        JsonSerializer.Serialize(writer, value.Specification, options);

        writer.WriteEndObject();
    }
}