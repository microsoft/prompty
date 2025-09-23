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


    /*
    /// <summary>
    /// Initializes a new instance of <see cref="FunctionTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FunctionTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FunctionTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind");
        }
        if (data.TryGetValue("parameters", out var parametersValue))
        {
            instance.Parameters = LoadParameters(parametersValue);
        }
        return instance;
    }
    
    internal static IList<Parameter> LoadParameters(object data)
    {
        return [.. data.GetNamedDictionaryList().Select(item => Parameter.Load(item))];
    }
    
    
    */
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
            var instance = new FunctionTool();

            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("parameters", out JsonElement parametersValue))
            {
                // need object collection deserialization
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