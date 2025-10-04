// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class CodeInterpreterToolJsonConverter : JsonConverter<CodeInterpreterTool>
{
    public override CodeInterpreterTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to CodeInterpreterTool.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing CodeInterpreterTool: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new CodeInterpreterTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("fileIds", out JsonElement fileIdsValue))
            {
                instance.FileIds = [.. fileIdsValue.EnumerateArray().Select(x => x.GetString() ?? throw new JsonException("Empty array elements for fileIds are not supported"))];
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, CodeInterpreterTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("fileIds");
        JsonSerializer.Serialize(writer, value.FileIds, options);

        writer.WriteEndObject();
    }
}