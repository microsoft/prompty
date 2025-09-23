// Copyright (c) Microsoft. All rights reserved.
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
    

    /// <summary>
    /// Initializes a new instance of <see cref="ModelTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new ModelTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new ModelTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("model", out var modelValue))
        {
            instance.Model = Model.Load(modelValue.ToParamDictionary());
        }
        return instance;
    }
    
    
}


public class ModelToolConverter: JsonConverter<ModelTool>
{
    public override ModelTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new ModelTool();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new ModelTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("model", out JsonElement modelValue))
            {
                instance.Model = JsonSerializer.Deserialize<Model>(modelValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return ModelTool.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, ModelTool value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if(value.Kind != null)
        {
            writer.WritePropertyName("kind");
            JsonSerializer.Serialize(writer, value.Kind, options);
        }
        if(value.Model != null)
        {
            writer.WritePropertyName("model");
            JsonSerializer.Serialize(writer, value.Model, options);
        }
        writer.WriteEndObject();
    }
}