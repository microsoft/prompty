/**
 * C# scaffolding emitter — static support files.
 *
 * Replaces `context.cs.njk` and `utils.cs.njk` Nunjucks templates with typed
 * TypeScript functions that produce the same C# source code.
 *
 * Emitted files:
 *   - Context.cs  — LoadContext / SaveContext helper classes
 *   - Utils.cs    — JsonUtils, YamlUtils, and internal Utils extension methods
 */

// ============================================================================
// Context.cs
// ============================================================================

/**
 * Emit the C# LoadContext / SaveContext file.
 */
export function emitCSharpContext(namespace: string): string {
  return `// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace ${namespace};
#pragma warning restore IDE0130

/// <summary>
/// Context for customizing the loading process of agent definitions.
/// Provides hooks for pre-processing input data before parsing and
/// post-processing output data after instantiation.
/// </summary>
public class LoadContext
{
    /// <summary>
    /// Optional callback to transform input data before parsing.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PreProcess { get; set; }

    /// <summary>
    /// Optional callback to transform the result after instantiation.
    /// </summary>
    public Func<object, object>? PostProcess { get; set; }

    /// <summary>
    /// Apply pre-processing to input data if a PreProcess callback is set.
    /// </summary>
    /// <param name="data">The raw input dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessInput(Dictionary<string, object?> data)
    {
        if (PreProcess is not null)
        {
            return PreProcess(data);
        }
        return data;
    }

    /// <summary>
    /// Apply post-processing to the result if a PostProcess callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the result.</typeparam>
    /// <param name="result">The instantiated object to process.</param>
    /// <returns>The processed result, or the original if no callback is set.</returns>
    public T ProcessOutput<T>(T result) where T : class
    {
        if (PostProcess is not null)
        {
            return (T)PostProcess(result);
        }
        return result;
    }
}

/// <summary>
/// Context for customizing the serialization process of agent definitions.
/// Provides hooks for pre-processing the object before serialization and
/// post-processing the dictionary after serialization.
/// </summary>
public class SaveContext
{
    /// <summary>
    /// Optional callback to transform the object before serialization.
    /// </summary>
    public Func<object, object>? PreSave { get; set; }

    /// <summary>
    /// Optional callback to transform the dictionary after serialization.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PostSave { get; set; }

    /// <summary>
    /// Output format for collections: "object" (name as key) or "array" (list of dicts).
    /// Defaults to "object".
    /// </summary>
    public string CollectionFormat { get; set; } = "object";

    /// <summary>
    /// Use shorthand scalar representation when possible (e.g., {"myTool": "function"}).
    /// Defaults to true.
    /// </summary>
    public bool UseShorthand { get; set; } = true;

    /// <summary>
    /// Apply pre-processing to the object if a PreSave callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the object.</typeparam>
    /// <param name="obj">The object to process before serialization.</param>
    /// <returns>The processed object, or the original if no callback is set.</returns>
    public T ProcessObject<T>(T obj) where T : class
    {
        if (PreSave is not null)
        {
            return (T)PreSave(obj);
        }
        return obj;
    }

    /// <summary>
    /// Apply post-processing to the dictionary if a PostSave callback is set.
    /// </summary>
    /// <param name="data">The serialized dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessDict(Dictionary<string, object?> data)
    {
        if (PostSave is not null)
        {
            return PostSave(data);
        }
        return data;
    }

    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly ISerializer s_yamlSerializer = new SerializerBuilder()
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    /// <summary>
    /// Convert the dictionary to a YAML string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <returns>The YAML string representation.</returns>
    public string ToYaml(Dictionary<string, object?> data)
    {
        return s_yamlSerializer.Serialize(data);
    }

    /// <summary>
    /// Convert the dictionary to a JSON string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation.</returns>
    public string ToJson(Dictionary<string, object?> data, bool indent = true)
    {
        var options = indent ? s_jsonOptions : new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        return JsonSerializer.Serialize(data, options);
    }
}
`;
}

// ============================================================================
// Utils.cs
// ============================================================================

/**
 * Emit the C# utility classes file (JsonUtils, YamlUtils, Utils).
 */
export function emitCSharpUtils(namespace: string): string {
  return `// Copyright (c) Microsoft. All rights reserved.
using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

#pragma warning disable IDE0130
namespace ${namespace};
#pragma warning restore IDE0130

/// <summary>
/// JSON serialization utilities.
/// </summary>
public static class JsonUtils
{
    /// <summary>
    /// Default JSON serializer options with support for nested dictionaries.
    /// </summary>
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new DictionaryJsonConverter() }
    };

    /// <summary>
    /// Extract a value from a JsonElement.
    /// </summary>
    public static object? GetJsonElementValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => GetNumericValue(element),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            _ => element.GetRawText()
        };
    }

    /// <summary>
    /// Get the appropriate numeric type from a JSON element.
    /// </summary>
    private static object GetNumericValue(JsonElement element)
    {
        // Try int first (most common case for small integers)
        if (element.TryGetInt32(out var i))
            return i;
        // Then try long for larger integers
        if (element.TryGetInt64(out var l))
            return l;
        // Fall back to double for decimals
        return element.GetDouble();
    }

    /// <summary>
    /// Custom converter to properly deserialize nested objects as dictionaries.
    /// </summary>
    private class DictionaryJsonConverter : JsonConverter<Dictionary<string, object?>>
    {
        public override Dictionary<string, object?> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartObject)
                throw new JsonException("Expected StartObject token");

            var dict = new Dictionary<string, object?>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                    return dict;

                if (reader.TokenType != JsonTokenType.PropertyName)
                    throw new JsonException("Expected PropertyName token");

                var key = reader.GetString()!;
                reader.Read();
                dict[key] = ReadValue(ref reader, options);
            }
            throw new JsonException("Expected EndObject token");
        }

        private object? ReadValue(ref Utf8JsonReader reader, JsonSerializerOptions options)
        {
            return reader.TokenType switch
            {
                JsonTokenType.String => reader.GetString(),
                JsonTokenType.Number => GetNumericValue(reader),
                JsonTokenType.True => true,
                JsonTokenType.False => false,
                JsonTokenType.Null => null,
                JsonTokenType.StartObject => Read(ref reader, typeof(Dictionary<string, object?>), options),
                JsonTokenType.StartArray => ReadArray(ref reader, options),
                _ => throw new JsonException($"Unexpected token type: {reader.TokenType}")
            };
        }

        private static object GetNumericValue(Utf8JsonReader reader)
        {
            // Try int first (most common case for small integers)
            if (reader.TryGetInt32(out var i))
                return i;
            // Then try long for larger integers
            if (reader.TryGetInt64(out var l))
                return l;
            // Fall back to double for decimals
            return reader.GetDouble();
        }

        private List<object?> ReadArray(ref Utf8JsonReader reader, JsonSerializerOptions options)
        {
            var list = new List<object?>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                    return list;
                list.Add(ReadValue(ref reader, options));
            }
            throw new JsonException("Expected EndArray token");
        }

        public override void Write(Utf8JsonWriter writer, Dictionary<string, object?> value, JsonSerializerOptions options)
        {
            JsonSerializer.Serialize(writer, value, options);
        }
    }
}

/// <summary>
/// YAML serialization utilities.
/// </summary>
public static class YamlUtils
{
    /// <summary>
    /// Default YAML deserializer.
    /// </summary>
    public static readonly IDeserializer Deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();

    /// <summary>
    /// Default YAML serializer.
    /// </summary>
    public static readonly ISerializer Serializer = new SerializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    /// <summary>
    /// Parse a YAML scalar string to a typed value.
    /// Uses YAML deserialization to properly handle quoted strings and types.
    /// Returns the properly typed value (bool, int, double, or string).
    /// </summary>
    public static object? ParseScalar(string yaml)
    {
        // Handle null/empty
        if (string.IsNullOrWhiteSpace(yaml))
            return null;

        // Use YAML deserializer to properly handle quoted strings and type inference
        try
        {
            var result = Deserializer.Deserialize<object>(yaml);
            // YamlDotNet returns strings for everything when deserializing to object
            // We need to do additional type parsing
            if (result is string str)
            {
                if (str == "null" || str == "~" || str == "")
                    return null;
                if (str == "true" || str == "True" || str == "TRUE")
                    return true;
                if (str == "false" || str == "False" || str == "FALSE")
                    return false;
                if (int.TryParse(str, out var intValue))
                    return intValue;
                if (double.TryParse(str, out var doubleValue))
                    return doubleValue;
                return str;
            }
            return result;
        }
        catch
        {
            return yaml;
        }
    }
}

/// <summary>
/// Utilities for retrieving property values and working with dictionaries.
/// </summary>
internal static class Utils
{
    public static object? GetScalarValue(this JsonElement obj)
    {
        return obj.ValueKind switch
        {
            JsonValueKind.String => obj.GetString(),
            JsonValueKind.Number => obj.GetRawText().Contains('.') ? obj.GetSingle() : obj.GetInt32(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Array => obj.EnumerateArray().Select(static x => x.GetScalarValue()).ToArray(),
            JsonValueKind.Null => null,
            JsonValueKind.Object => null,
            JsonValueKind.Undefined => null,
            _ => null,
        };
    }

    /// <summary>
    /// Retrieves a value from the dictionary by key and attempts to convert it to the specified type T.
    /// </summary>
    /// <typeparam name="T">The type to convert the value to.</typeparam>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the value to retrieve.</param>
    /// <returns>The value converted to type T, or default if not found.</returns>
    public static T? GetValue<T>(this Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is not null)
        {
            if (value is T typedValue)
            {
                return typedValue;
            }
            try
            {
                return (T)Convert.ChangeType(value, typeof(T));
            }
            catch
            {
                return default;
            }
        }
        return default;
    }

    /// <summary>
    /// Retrieves a nested dictionary from the dictionary by key.
    /// </summary>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the nested dictionary.</param>
    /// <returns>Dictionary if found; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value))
        {
            return value.GetDictionary();
        }
        return new Dictionary<string, object?>();
    }

    /// <summary>
    /// Retrieves a nested dictionary from any object.
    /// Handles both Dictionary&lt;string, object?&gt; and Dictionary&lt;object, object&gt; (from YAML).
    /// </summary>
    /// <param name="obj">The object that should be a dictionary.</param>
    /// <returns>Dictionary if the object is a dictionary; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this object? obj)
    {
        if (obj is Dictionary<string, object?> dict)
        {
            return dict;
        }
        // Handle YAML's Dictionary<object, object>
        if (obj is IDictionary<object, object> objDict)
        {
            return objDict.ToDictionary(
                kvp => kvp.Key?.ToString() ?? string.Empty,
                kvp => (object?)kvp.Value);
        }
        return new Dictionary<string, object?>();
    }

    /// <summary>
    /// Retrieves a nested dictionary from any object, with shorthand property support.
    /// If the object is not a dictionary and a shorthand property is specified,
    /// wraps the scalar value as { shorthandProperty: value }.
    /// </summary>
    /// <param name="obj">The object that should be a dictionary.</param>
    /// <param name="shorthandProperty">Optional shorthand property name for scalar wrapping.</param>
    /// <returns>Dictionary if the object is a dictionary; shorthand-wrapped dict for scalars; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this object? obj, string? shorthandProperty)
    {
        var dict = obj.GetDictionary();
        if (dict.Count > 0) return dict;
        if (shorthandProperty is not null && obj is not null)
            return new Dictionary<string, object?> { [shorthandProperty] = obj };
        return dict;
    }

    /// <summary>
    /// Retrieves a value from the dictionary by key and attempts to convert it to the specified type T.
    /// </summary>
    /// <typeparam name="T">The type to convert the value to.</typeparam>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the value to retrieve.</param>
    /// <returns></returns>
    public static T? GetValueOrDefault<T>(this IDictionary<string, object> dict, string key)
    {
        // check if T is a class and use .ctor recursively
        if (dict.TryGetValue(key, out var value))
        {
            return (T?)Convert.ChangeType(value, typeof(T));
        }
        return default;
    }

    /// <summary>
    /// Converts a named dictionary or list of dictionaries into a list of dictionaries (for normalizing Named objects into List objects).
    /// </summary>
    /// <param name="data"></param>
    /// <returns>List of dictionaries</returns>
    public static IList<IDictionary<string, object>> GetNamedDictionaryList(this object data)
    {
        if (data is IDictionary<string, object> dict)
        {
            return [.. dict
                .Where(kvp => kvp.Value is IDictionary<string, object>)
                .Select(kvp =>
                {
                    var newDict = new Dictionary<string, object>((IDictionary<string, object>)kvp.Value!)
                    {
                        { "name", kvp.Key }
                    };
                    return (IDictionary<string, object>)newDict;
                })];
        }
        if (data is IEnumerable<object> enumerable)
        {
            return [.. enumerable.OfType<IDictionary<string, object>>()];
        }
        return [];
    }

    /// <summary>
    /// Retrieves a nested dictionary from the dictionary by key.
    /// </summary>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the nested dictionary.</param>
    /// <returns>Dictionary&lt;string, object&gt; if found; otherwise, an empty dictionary.</returns>
    public static IDictionary<string, object> GetDictionaryOrDefault(this IDictionary<string, object> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is IDictionary<string, object> nestedDict)
        {
            return nestedDict;
        }
        return new Dictionary<string, object>();
    }

    /// <summary>
    /// Expands a dictionary by converting its keys and values to strings and more usable formats.
    /// </summary>
    /// <param name="dictionary">The dictionary to expand.</param>
    /// <returns>A new dictionary with expanded keys and values.</returns>
    private static Dictionary<string, object> Expand(IDictionary dictionary)
    {
        var dict = new Dictionary<string, object>();
        foreach (DictionaryEntry entry in dictionary)
        {
            if (entry.Value != null)
                dict.Add(entry.Key.ToString()!, GetValue(entry.Value));
        }
        return dict;
    }

    /// <summary>
    /// Expands a dictionary by converting its values to a more usable format.
    /// </summary>
    /// <param name="o">The object to convert.</param>
    /// <returns>A more usable object.</returns>
    private static object GetValue(object o)
    {
        return Type.GetTypeCode(o.GetType()) switch
        {
            TypeCode.Object => o switch
            {

                IDictionary dict => Expand(dict),
                IList list => Enumerable.Range(0, list.Count).Where(i => list[i] != null).Select(i => list[i]!.ToParamDictionary()).ToArray(),
                _ => o.ToParamDictionary(),
            },
            _ => o,
        };
    }

    /// <summary>
    /// Converts an object to a dictionary of parameters.
    /// </summary>
    /// <param name="obj">The object to convert.</param>
    /// <returns>A dictionary of parameters.</returns>
    public static IDictionary<string, object> ToParamDictionary(this object obj)
    {
        if (obj == null)
            return new Dictionary<string, object>();

        else if (obj is IDictionary<string, object> dictionary)
            return dictionary;

        var items = obj.GetType()
              .GetProperties(BindingFlags.Public | BindingFlags.Instance)
              .Where(prop => prop.GetGetMethod() != null);

        var dict = new Dictionary<string, object>();

        foreach (var item in items)
        {
            var value = item.GetValue(obj);
            if (value != null)
                dict.Add(item.Name, GetValue(value));
        }

        return dict;
    }
}
`;
}
