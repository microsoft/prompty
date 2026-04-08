// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;

namespace Prompty.Core;

/// <summary>
/// A dictionary carrying structured output from an LLM.
/// Behaves exactly like Dictionary&lt;string, object?&gt; but also stores
/// the raw JSON string so that Cast&lt;T&gt;() can deserialize directly
/// without an intermediate dict round-trip.
/// </summary>
public class StructuredResult : Dictionary<string, object?>
{
    /// <summary>
    /// The raw JSON string from the LLM response.
    /// </summary>
    public string RawJson { get; }

    /// <summary>
    /// Create a StructuredResult from parsed data and raw JSON.
    /// </summary>
    public StructuredResult(Dictionary<string, object?> data, string rawJson)
        : base(data)
    {
        RawJson = rawJson;
    }

    /// <summary>
    /// Deserialize the raw JSON directly to a typed object.
    /// </summary>
    public T Cast<T>() => PromptyCast.Cast<T>(this);

    /// <summary>
    /// Create a StructuredResult from a raw JSON string.
    /// Parses the JSON into native C# types (Dictionary, List, string, etc.)
    /// </summary>
    public static StructuredResult FromJson(string json)
    {
        var doc = JsonDocument.Parse(json);
        var dict = ElementToNative(doc.RootElement) as Dictionary<string, object?>
            ?? new Dictionary<string, object?>();
        return new StructuredResult(dict, json);
    }

    internal static object? ElementToNative(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject()
            .ToDictionary(p => p.Name, p => ElementToNative(p.Value)),
        JsonValueKind.Array => element.EnumerateArray()
            .Select(ElementToNative).ToList() as object,
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : (object)element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => element.GetRawText(),
    };
}

/// <summary>
/// Internal helper for casting any result to a typed object.
/// Use <see cref="StructuredResult.Cast{T}"/> or <see cref="Pipeline.InvokeAsync{T}"/> instead.
/// </summary>
internal static class PromptyCast
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Cast a result to a typed object. When the result is a StructuredResult,
    /// deserializes directly from the raw JSON (optimal path).
    /// </summary>
    public static T Cast<T>(object result)
    {
        string jsonStr = result switch
        {
            StructuredResult sr => sr.RawJson,
            string s => s,
            _ => JsonSerializer.Serialize(result, Options),
        };

        return JsonSerializer.Deserialize<T>(jsonStr, Options)
            ?? throw new InvalidOperationException($"Failed to deserialize to {typeof(T).Name}");
    }
}
