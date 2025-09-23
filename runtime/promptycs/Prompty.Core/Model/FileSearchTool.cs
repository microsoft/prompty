// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// A tool for searching files.
/// This tool allows an AI agent to search for files based on a query.
/// </summary>
[JsonConverter(typeof(FileSearchToolConverter))]
public class FileSearchTool : Tool
{
    /// <summary>
    /// Initializes a new instance of <see cref="FileSearchTool"/>.
    /// </summary>
    public FileSearchTool()
    {
    }
        
    /// <summary>
    /// The kind identifier for file search tools
    /// </summary>
    public override string Kind { get; set; } = "file_search";
        
    /// <summary>
    /// The connection configuration for the file search tool
    /// </summary>
    public Connection Connection { get; set; }
        
    /// <summary>
    /// The maximum number of search results to return.
    /// </summary>
    public int? MaxNumResults { get; set; }
        
    /// <summary>
    /// File search ranker.
    /// </summary>
    public string Ranker { get; set; } = string.Empty;
        
    /// <summary>
    /// Ranker search threshold.
    /// </summary>
    public float ScoreThreshold { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="FileSearchTool"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new FileSearchTool Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new FileSearchTool();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("connection", out var connectionValue))
        {
            instance.Connection = Connection.Load(connectionValue.ToParamDictionary());
        }
        if (data.TryGetValue("maxNumResults", out var maxNumResultsValue))
        {
            instance.MaxNumResults = (int)maxNumResultsValue;
        }
        if (data.TryGetValue("ranker", out var rankerValue))
        {
            instance.Ranker = rankerValue as string ?? throw new ArgumentException("Properties must contain a property named: ranker", nameof(props));
        }
        if (data.TryGetValue("scoreThreshold", out var scoreThresholdValue))
        {
            instance.ScoreThreshold = (float)scoreThresholdValue;
        }
        return instance;
    }
    
    
}


public class FileSearchToolConverter: JsonConverter<FileSearchTool>
{
    public override FileSearchTool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
         if (reader.TokenType == JsonTokenType.Null)
        {
            return new FileSearchTool();
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;
            var instance = new FileSearchTool();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = JsonSerializer.Deserialize<string>(kindValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("connection", out JsonElement connectionValue))
            {
                instance.Connection = JsonSerializer.Deserialize<Connection>(connectionValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("maxNumResults", out JsonElement maxNumResultsValue))
            {
                instance.MaxNumResults = JsonSerializer.Deserialize<int?>(maxNumResultsValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("ranker", out JsonElement rankerValue))
            {
                instance.Ranker = JsonSerializer.Deserialize<string>(rankerValue.GetRawText(), options);
            }
            if (rootElement.TryGetProperty("scoreThreshold", out JsonElement scoreThresholdValue))
            {
                instance.ScoreThreshold = JsonSerializer.Deserialize<float>(scoreThresholdValue.GetRawText(), options);
            }

            var dict = rootElement.ToParamDictionary();
            return FileSearchTool.Load(dict);
        }
    }

    public override void Write(Utf8JsonWriter writer, FileSearchTool value, JsonSerializerOptions options)
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
        if(value.MaxNumResults != null)
        {
            writer.WritePropertyName("maxNumResults");
            JsonSerializer.Serialize(writer, value.MaxNumResults, options);
        }
        if(value.Ranker != null)
        {
            writer.WritePropertyName("ranker");
            JsonSerializer.Serialize(writer, value.Ranker, options);
        }
        if(value.ScoreThreshold != null)
        {
            writer.WritePropertyName("scoreThreshold");
            JsonSerializer.Serialize(writer, value.ScoreThreshold, options);
        }
        writer.WriteEndObject();
    }
}