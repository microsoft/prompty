// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Represents a local function tool.
/// </summary>
[JsonConverter(typeof(FunctionToolConverter))]
public class FunctionTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="FunctionTool"/>.
    /// </summary>
    public FunctionTool()
    {
    }

    /// <summary>
    /// The kind identifier for function tools
    /// </summary>
    public override string Kind { get; set; } = "function";

    /// <summary>
    /// Parameters accepted by the function tool
    /// </summary>
    public IList<Parameter> Parameters { get; set; } = [];

}

public class FunctionToolConverter : JsonConverter<FunctionTool>
{
    public override FunctionTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to FunctionTool.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new FunctionTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("parameters", out JsonElement parametersValue))
            {
                if (parametersValue.ValueKind == JsonValueKind.Array)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateArray()
                            .Select(x => JsonSerializer.Deserialize<Parameter> (x.GetRawText(), options)
                                ?? throw new ArgumentException("Empty array elements for Parameters are not supported"))];
                }
                else if (parametersValue.ValueKind == JsonValueKind.Object)
                {
                    instance.Parameters =
                        [.. parametersValue.EnumerateObject()
                            .Select(property =>
                            {
                                var item = JsonSerializer.Deserialize<Parameter>(property.Value.GetRawText(), options)
                                    ?? throw new ArgumentException("Empty array elements for Parameters are not supported");
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

    public override void Write(Utf8JsonWriter writer, FunctionTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("parameters");
        JsonSerializer.Serialize(writer, value.Parameters, options);

        writer.WriteEndObject();
    }
}