// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Configuration options for the Bing search tool.
/// </summary>
[JsonConverter(typeof(BingSearchConfigurationConverter))]
public class BingSearchConfiguration
{
    /// <summary>
    /// Initializes a new instance of <see cref="BingSearchConfiguration"/>.
    /// </summary>
    public BingSearchConfiguration()
    {
    }

    /// <summary>
    /// The name of the Bing search tool instance, used to identify the specific instance in the system
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Connection id for grounding with bing search
    /// </summary>
    public string ConnectionId { get; set; } = string.Empty;

    /// <summary>
    /// The market where the results come from.
    /// </summary>
    public string? Market { get; set; }

    /// <summary>
    /// The language to use for user interface strings when calling Bing API.
    /// </summary>
    public string? SetLang { get; set; }

    /// <summary>
    /// The number of search results to return in the bing api response
    /// </summary>
    public long? Count { get; set; }

    /// <summary>
    /// Filter search results by a specific time range. Accepted values: https://learn.microsoft.com/bing/search-apis/bing-web-search/reference/query-parameters
    /// </summary>
    public string? Freshness { get; set; }

}

public class BingSearchConfigurationConverter : JsonConverter<BingSearchConfiguration>
{
    public override BingSearchConfiguration Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to BingSearchConfiguration.");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new BingSearchConfiguration();
            if (rootElement.TryGetProperty("name", out JsonElement nameValue))
            {
                instance.Name = nameValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: name");
            }

            if (rootElement.TryGetProperty("connectionId", out JsonElement connectionIdValue))
            {
                instance.ConnectionId = connectionIdValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: connectionId");
            }

            if (rootElement.TryGetProperty("market", out JsonElement marketValue))
            {
                instance.Market = marketValue.GetString();
            }

            if (rootElement.TryGetProperty("setLang", out JsonElement setLangValue))
            {
                instance.SetLang = setLangValue.GetString();
            }

            if (rootElement.TryGetProperty("count", out JsonElement countValue))
            {
                instance.Count = countValue.GetInt64();
            }

            if (rootElement.TryGetProperty("freshness", out JsonElement freshnessValue))
            {
                instance.Freshness = freshnessValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, BingSearchConfiguration value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        JsonSerializer.Serialize(writer, value.Name, options);

        writer.WritePropertyName("connectionId");
        JsonSerializer.Serialize(writer, value.ConnectionId, options);

        if (value.Market != null)
        {
            writer.WritePropertyName("market");
            JsonSerializer.Serialize(writer, value.Market, options);
        }

        if (value.SetLang != null)
        {
            writer.WritePropertyName("setLang");
            JsonSerializer.Serialize(writer, value.SetLang, options);
        }

        if (value.Count != null)
        {
            writer.WritePropertyName("count");
            JsonSerializer.Serialize(writer, value.Count, options);
        }

        if (value.Freshness != null)
        {
            writer.WritePropertyName("freshness");
            JsonSerializer.Serialize(writer, value.Freshness, options);
        }

        writer.WriteEndObject();
    }
}