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
[JsonConverter(typeof(McpToolConverter))]
public class McpTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
    public McpTool()
    {
    }

    /// <summary>
    /// The kind identifier for MCP tools
    /// </summary>
    public override string Kind { get; set; } = "mcp";

    /// <summary>
    /// The connection configuration for the MCP tool
    /// </summary>
    public Connection Connection { get; set; }

    /// <summary>
    /// The name of the MCP tool
    /// </summary>
    public override string Name { get; set; } = string.Empty;

    /// <summary>
    /// The URL of the MCP server
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// List of allowed operations or resources for the MCP tool
    /// </summary>
    public IList<string> Allowed { get; set; } = [];

}

public class McpToolConverter : JsonConverter<McpTool>
{
    public override McpTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to McpTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing McpTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new McpTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: connection");
            }

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("url", out JsonElement urlValue))
            {
                instance.Url = urlValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: url");
            }

            if (rootElement.TryGetProperty("allowed", out JsonElement allowedValue))
            {
                instance.Allowed = [.. allowedValue.EnumerateArray().Select(x => x.GetString() ?? throw new JsonException("Empty array elements for allowed are not supported"))];
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, McpTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("connection");
        JsonSerializer.Serialize(writer, value.Connection, options);

        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("url");
        JsonSerializer.Serialize(writer, value.Url, options);

        writer.WritePropertyName("allowed");
        JsonSerializer.Serialize(writer, value.Allowed, options);

        writer.WriteEndObject();
    }
}