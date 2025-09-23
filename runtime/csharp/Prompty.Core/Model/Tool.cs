// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a tool that can be used in prompts.
/// </summary>
[JsonConverter(typeof(ToolConverter))]
public abstract class Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="Tool"/>.
    /// </summary>
    protected Tool()
    {
    }

    /// <summary>
    /// Name of the tool. If a function tool, this is the function name, otherwise it is the type
    /// </summary>
    public virtual string Name { get; set; } = string.Empty;

    /// <summary>
    /// The kind identifier for the tool
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// A short description of the tool for metadata purposes
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Tool argument bindings to input properties
    /// </summary>
    public IList<Binding>? Bindings { get; set; }

}

public class ToolConverter : JsonConverter<Tool>
{
    public override Tool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to Tool.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic Tool instance
            Tool instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for Tool is not supported");
                instance = discriminator switch
                {
                    "function" => JsonSerializer.Deserialize<FunctionTool>(rootElement, options)
                        ?? throw new JsonException("Empty FunctionTool instances are not supported"),
                    "bing_search" => JsonSerializer.Deserialize<BingSearchTool>(rootElement, options)
                        ?? throw new JsonException("Empty BingSearchTool instances are not supported"),
                    "file_search" => JsonSerializer.Deserialize<FileSearchTool>(rootElement, options)
                        ?? throw new JsonException("Empty FileSearchTool instances are not supported"),
                    "mcp" => JsonSerializer.Deserialize<McpTool>(rootElement, options)
                        ?? throw new JsonException("Empty McpTool instances are not supported"),
                    "model" => JsonSerializer.Deserialize<ModelTool>(rootElement, options)
                        ?? throw new JsonException("Empty ModelTool instances are not supported"),
                    "openapi" => JsonSerializer.Deserialize<OpenApiTool>(rootElement, options)
                        ?? throw new JsonException("Empty OpenApiTool instances are not supported"),
                    _ => new ServerTool(),
                };
            }
            else
            {
                throw new JsonException("Missing Tool discriminator property: 'kind'");
            }
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = descriptionValue.GetString();
            }

            if (rootElement.TryGetProperty("bindings", out JsonElement bindingsValue))
            {
                if (bindingsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Bindings =
                        [.. bindingsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Binding> (x.GetRawText(), options)
                                ?? throw new ArgumentException("Empty array elements for Bindings are not supported"))];
                }
                else if (bindingsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Bindings =
                        [.. bindingsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Binding>(property.Value.GetRawText(), options)
                                    ?? throw new ArgumentException("Empty array elements for Bindings are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for bindings");
                }
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, Tool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        if (value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }

        if (value.Bindings != null)
        {
            writer.WritePropertyName("bindings");
            JsonSerializer.Serialize(writer, value.Bindings, options);
        }

        writer.WriteEndObject();
    }
}