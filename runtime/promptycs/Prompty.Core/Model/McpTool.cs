// Copyright (c) Microsoft. All rights reserved.
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
    

    /// <summary>
    /// Initializes a new instance of <see cref="McpTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new McpTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new McpTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("name", out var nameValue))
        {
            instance.Name = nameValue as string ?? throw new ArgumentException("Properties must contain a property named: name", nameof(props));
        }
        if (data.TryGetValue("url", out var urlValue))
        {
            instance.Url = urlValue as string ?? throw new ArgumentException("Properties must contain a property named: url", nameof(props));
        }
        if (data.TryGetValue("allowed", out var allowedValue))
        {
            instance.Allowed = allowedValue as IList<string> ?? throw new ArgumentException("Properties must contain a property named: allowed", nameof(props));
        }
        return instance;
    }
    
    
}


public class McpToolConverter: JsonConverter<McpTool>
{
    public override McpTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new McpTool();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new McpTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = JsonSerializer.Deserialize<string>(nameValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("url", out JsonElement urlValue))
            {
                instance.Url = JsonSerializer.Deserialize<string>(urlValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("allowed", out JsonElement allowedValue))
            {
                instance.Allowed = JsonSerializer.Deserialize<IList<string>>(allowedValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return McpTool.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, McpTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Connection != null)
        {
            writer.WritePropertyName("connection");
            JsonSerializer.Serialize(writer, value.Connection, options);
        }
        if(value.Name != null)
        {
            writer.WritePropertyName("name");
            JsonSerializer.Serialize(writer, value.Name, options);
        }
        if(value.Url != null)
        {
            writer.WritePropertyName("url");
            JsonSerializer.Serialize(writer, value.Url, options);
        }
        if(value.Allowed != null)
        {
            writer.WritePropertyName("allowed");
            JsonSerializer.Serialize(writer, value.Allowed, options);
        }
        writer.WriteEndObject();
    }
}