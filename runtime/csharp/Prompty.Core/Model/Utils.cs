// Copyright (c) Microsoft. All rights reserved.
using System.Collections;
using System.Reflection;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Utilities for retrieving property values.
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
    /// <returns>Dictionary<string, object> if found; otherwise, an empty dictionary.</returns>
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
