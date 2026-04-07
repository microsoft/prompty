// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prompty.Core.Tracing;

/// <summary>
/// Serializes objects to JSON-safe representations for tracing.
/// Implements spec §3.3 (to_dict) and §3.4 (redaction).
/// </summary>
public static class TraceSerializer
{
    /// <summary>Sensitive key substrings per spec §3.4.</summary>
    private static readonly string[] SensitivePatterns =
    [
        "secret", "password", "api_key", "apikey", "token", "auth", "credential", "cookie"
    ];

    private const string Redacted = "[REDACTED]";
    private const int MaxDepth = 20;

    /// <summary>
    /// Convert any object to a JSON-safe representation.
    /// Applies redaction for sensitive keys per spec §3.4.
    /// </summary>
    public static object? ToDict(object? value, int depth = 0)
    {
        if (depth > MaxDepth) return "[max depth exceeded]";

        return value switch
        {
            null => null,
            string s => s,
            bool b => b,
            int or long or float or double or decimal => value,
            DateTime dt => dt.ToUniversalTime().ToString("O"),
            DateTimeOffset dto => dto.UtcDateTime.ToString("O"),
            JsonElement je => JsonElementToDict(je, depth),
            IDictionary<string, object?> dict => RedactDict(dict, depth),
            IDictionary<string, string> sdict => RedactDict(
                sdict.ToDictionary(kv => kv.Key, kv => (object?)kv.Value), depth),
            IList<object?> list => list.Select(item => ToDict(item, depth + 1)).ToList(),
            IEnumerable<object?> enumerable => enumerable.Select(item => ToDict(item, depth + 1)).ToList(),
            Exception ex => new Dictionary<string, object?>
            {
                ["exception"] = ex.GetType().Name,
                ["message"] = ex.Message,
                ["traceback"] = ex.StackTrace,
            },
            _ => SerializeObject(value, depth),
        };
    }

    /// <summary>
    /// Check whether a key name is sensitive and should be redacted.
    /// </summary>
    public static bool IsSensitiveKey(string key)
    {
        var lower = key.ToLowerInvariant();
        return SensitivePatterns.Any(p => lower.Contains(p));
    }

    private static object? RedactDict(IDictionary<string, object?> dict, int depth)
    {
        var result = new Dictionary<string, object?>();
        foreach (var (key, val) in dict)
        {
            result[key] = IsSensitiveKey(key) ? Redacted : ToDict(val, depth + 1);
        }
        return result;
    }

    private static object? JsonElementToDict(JsonElement element, int depth) => element.ValueKind switch
    {
        JsonValueKind.Object => RedactDict(
            element.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value), depth),
        JsonValueKind.Array => element.EnumerateArray().Select(e => ToDict(e, depth + 1)).ToList(),
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };

    private static object? SerializeObject(object value, int depth)
    {
        // Try to serialize as JSON and then convert back to dict
        try
        {
            var json = JsonSerializer.Serialize(value, SerializerOptions);
            var element = JsonDocument.Parse(json).RootElement;
            return JsonElementToDict(element, depth);
        }
        catch
        {
            return value.ToString();
        }
    }

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
        MaxDepth = MaxDepth,
    };
}
