// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
/// It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
/// The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
/// available tools, and template configurations for prompt rendering.
/// 
/// These can be written in a markdown format or in a pure YAML format.
/// </summary>
[JsonConverter(typeof(PromptyBaseConverter))]
public abstract class PromptyBase
{
    /// <summary>
    /// Initializes a new instance of <see cref="PromptyBase"/>.
    /// </summary>
    protected PromptyBase()
    {
    }

    /// <summary>
    /// Kind represented by the document
    /// </summary>
    public virtual string? Kind { get; set; }

    /// <summary>
    /// Unique identifier for the document
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// Document version
    /// </summary>
    public string? Version { get; set; }

    /// <summary>
    /// Human-readable name of the agent
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Description of the agent's capabilities and purpose
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Additional metadata including authors, tags, and other arbitrary properties
    /// </summary>
    public IDictionary<string, object>? Metadata { get; set; }

    /// <summary>
    /// Input parameters that participate in template rendering
    /// </summary>
    public IList<Input>? Inputs { get; set; }

    /// <summary>
    /// Expected output format and structure from the agent
    /// </summary>
    public IList<Output>? Outputs { get; set; }

    /// <summary>
    /// Tools available to the agent for extended functionality
    /// </summary>
    public IList<Tool>? Tools { get; set; }

    /// <summary>
    /// Template configuration for prompt rendering
    /// </summary>
    public Template? Template { get; set; }

    /// <summary>
    /// Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)
    /// </summary>
    public string? Instructions { get; set; }

    /// <summary>
    /// Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)
    /// </summary>
    public string? AdditionalInstructions { get; set; }

}

public class PromptyBaseConverter : JsonConverter<PromptyBase>
{
    public override PromptyBase Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to PromptyBase.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing PromptyBase: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // load polymorphic PromptyBase instance
            PromptyBase instance;
            if (rootElement.TryGetProperty("kind", out JsonElement discriminatorValue))
            {
                var discriminator = discriminatorValue.GetString()
                    ?? throw new JsonException("Empty discriminator value for PromptyBase is not supported");
                instance = discriminator switch
                {
                    "prompt" => JsonSerializer.Deserialize<Prompty>(rootElement, options)
                        ?? throw new JsonException("Empty Prompty instances are not supported"),
                    "manifest" => JsonSerializer.Deserialize<PromptyManifest>(rootElement, options)
                        ?? throw new JsonException("Empty PromptyManifest instances are not supported"),
                    "container" => JsonSerializer.Deserialize<PromptyContainer>(rootElement, options)
                        ?? throw new JsonException("Empty PromptyContainer instances are not supported"),
                    _ => throw new JsonException($"Unknown PromptyBase discriminator value: {discriminator}"),
                };
            }
            else
            {
                // default to "prompt" if discriminator is missing or empty
                instance = new PromptyBase
                {
                    Kind = "prompt"
                };
            }
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString();
            }

            if (rootElement.TryGetProperty("id", out JsonElement idValue))
            {
                instance.Id = idValue.GetString();
            }

            if (rootElement.TryGetProperty("version", out JsonElement versionValue))
            {
                instance.Version = versionValue.GetString();
            }

            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("description", out JsonElement descriptionValue))
            {
                instance.Description = descriptionValue.GetString();
            }

            if (rootElement.TryGetProperty("metadata", out JsonElement metadataValue))
            {
                instance.Metadata = JsonSerializer.Deserialize<Dictionary<string, object>>(metadataValue.GetRawText(), options);
            }

            if (rootElement.TryGetProperty("inputs", out JsonElement inputsValue))
            {
                if (inputsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Inputs =
                        [.. inputsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Input> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Inputs are not supported"))];
                }
                else if (inputsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Inputs =
                        [.. inputsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Input>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Inputs are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for inputs");
                }
            }

            if (rootElement.TryGetProperty("outputs", out JsonElement outputsValue))
            {
                if (outputsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Outputs =
                        [.. outputsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Output> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Outputs are not supported"))];
                }
                else if (outputsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Outputs =
                        [.. outputsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Output>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Outputs are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for outputs");
                }
            }

            if (rootElement.TryGetProperty("tools", out JsonElement toolsValue))
            {
                if (toolsValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Tools =
                        [.. toolsValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Tool> (x.GetRawText(), options)
                                ?? throw new JsonException("Empty array elements for Tools are not supported"))];
                }
                else if (toolsValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Tools =
                        [.. toolsValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Tool>(property.Value.GetRawText(), options)
                                    ?? throw new JsonException("Empty array elements for Tools are not supported");
                                item.Name = property.Name;
                                return item;
                            })];
                }
                else
                {
                    throw new JsonException("Invalid JSON token for tools");
                }
            }

            if (rootElement.TryGetProperty("template", out JsonElement templateValue))
            {
                instance.Template = JsonSerializer.Deserialize<Template?>(templateValue.GetRawText(), options);
            }

            if (rootElement.TryGetProperty("instructions", out JsonElement instructionsValue))
            {
                instance.Instructions = instructionsValue.GetString();
            }

            if (rootElement.TryGetProperty("additionalInstructions", out JsonElement additionalInstructionsValue))
            {
                instance.AdditionalInstructions = additionalInstructionsValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyBase value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if (value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }

        if (value.Id != null)
        {
            writer.WritePropertyName("id");
            JsonSerializer.Serialize(writer, value.Id, options);
        }

        if (value.Version != null)
        {
            writer.WritePropertyName("version");
            JsonSerializer.Serialize(writer, value.Version, options);
        }

        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        if (value.Description != null)
        {
            writer.WritePropertyName("description");
            JsonSerializer.Serialize(writer, value.Description, options);
        }

        if (value.Metadata != null)
        {
            writer.WritePropertyName("metadata");
            JsonSerializer.Serialize(writer, value.Metadata, options);
        }

        if (value.Inputs != null)
        {
            writer.WritePropertyName("inputs");
            JsonSerializer.Serialize(writer, value.Inputs, options);
        }

        if (value.Outputs != null)
        {
            writer.WritePropertyName("outputs");
            JsonSerializer.Serialize(writer, value.Outputs, options);
        }

        if (value.Tools != null)
        {
            writer.WritePropertyName("tools");
            JsonSerializer.Serialize(writer, value.Tools, options);
        }

        if (value.Template != null)
        {
            writer.WritePropertyName("template");
            JsonSerializer.Serialize(writer, value.Template, options);
        }

        if (value.Instructions != null)
        {
            writer.WritePropertyName("instructions");
            JsonSerializer.Serialize(writer, value.Instructions, options);
        }

        if (value.AdditionalInstructions != null)
        {
            writer.WritePropertyName("additionalInstructions");
            JsonSerializer.Serialize(writer, value.AdditionalInstructions, options);
        }

        writer.WriteEndObject();
    }
}