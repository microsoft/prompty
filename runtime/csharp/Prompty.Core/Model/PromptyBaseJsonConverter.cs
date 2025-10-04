// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class PromptyBaseJsonConverter : JsonConverter<PromptyBase>
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
                    "container" => JsonSerializer.Deserialize<PromptyContainer>(rootElement, options)
                        ?? throw new JsonException("Empty PromptyContainer instances are not supported"),
                    "hosted" => JsonSerializer.Deserialize<PromptyHostedContainer>(rootElement, options)
                        ?? throw new JsonException("Empty PromptyHostedContainer instances are not supported"),
                    "workflow" => JsonSerializer.Deserialize<PromptyWorkflow>(rootElement, options)
                        ?? throw new JsonException("Empty PromptyWorkflow instances are not supported"),
                    _ => throw new JsonException($"Unknown PromptyBase discriminator value: {discriminator}"),
                };
            }
            else
            {
                throw new JsonException("Missing PromptyBase discriminator property: 'kind'");
            }
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
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

            if (rootElement.TryGetProperty("model", out JsonElement modelValue))
            {
                instance.Model = JsonSerializer.Deserialize<Model>(modelValue.GetRawText(), options) ?? throw new ArgumentException("Properties must contain a property named: model");
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

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, PromptyBase value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

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

        writer.WritePropertyName("model");
        JsonSerializer.Serialize(writer, value.Model, options);

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

        writer.WriteEndObject();
    }
}