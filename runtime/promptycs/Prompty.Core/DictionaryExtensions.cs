using System.Collections;
using System.Reflection;
using System.Text.Json;

namespace Prompty.Core
{
    public static class DictionaryExtensions
    {




        public static Dictionary<string, object> ToDictionary(this JsonElement obj)
        {
            return JsonConverter.ConvertJsonElementToDictionary(obj);
        }

        public static T? GetValue<T>(this Dictionary<string, object> dict, string key, T? defaultValue = default)
        {
            if (dict.TryGetValue(key, out var value))
            {
                if (value is null)
                {
                    return defaultValue;
                }
                else if (typeof(T) == typeof(bool))
                {
                    if (Boolean.TryParse(value.ToString(), out var result))
                    {
                        return (T?)(object?)result;
                    }
                }
                else if (typeof(T).IsAssignableFrom(value.GetType()))
                {
                    return (T)value;
                }
                else
                {
                    throw new ArgumentException($"Cannot convert value {value} of type {value.GetType()} to {typeof(T)} for key '{key}'");
                }
            }

            return defaultValue;
        }

        public static IEnumerable<T> GetList<T>(this Dictionary<string, object> dict, string key)
        {
            // try to see if dictionary has key and can map to type
            if (dict.TryGetValue(key, out var value) && value is List<object> list)
            {
                if (list.Count > 0)
                    return list.Select(i => (T)i);
            }

            return [];
        }

        public static IEnumerable<T> GetList<S, T>(this Dictionary<string, object> dict, string key, Func<S, T> transform)
        {
            // try to see if dictionary has key and can map to type
            if (dict.TryGetValue(key, out var value) && value is List<object> list)
            {
                if (list.Count > 0)
                    return list.Select(i => transform((S)i));
            }
            return [];
        }

        public static IEnumerable<T> GetConfigList<T>(this Dictionary<string, object> dict, string key, Func<Dictionary<string, object>, T> transform)
        {
            return dict.GetList(key, transform);
        }

        public static Dictionary<string, object>? GetConfig(this Dictionary<string, object> dict, string key)
        {
            var sub = dict.GetValue<Dictionary<string, object>>(key);
            if (sub != null && sub.Count > 0)
                return sub;
            else
                return null;
        }

        public static Dictionary<string, object>? GetAndRemoveConfig(this Dictionary<string, object> dict, string key)
        {
            var sub = dict.GetAndRemove<Dictionary<string, object>>(key);
            if (sub != null && sub.Count > 0)
                return sub;
            else
                return null;
        }

        public static T? GetConfig<T>(this Dictionary<string, object> dict, string key, Func<Dictionary<string, object>, T> transform)
        {
            var item = dict.GetConfig(key);
            if (item != null)
                return transform(item);
            else
                return default;
        }

        public static Dictionary<string, object> ToConfig(this Dictionary<object, object> dict)
        {
            return dict.ToDictionary(kvp => (string)kvp.Key, kvp => kvp.Value);
        }

        public static T? GetAndRemove<T>(this Dictionary<string, object> dict, string key)
        {
            if (dict.TryGetValue(key, out var value) && value is T v)
            {
                dict.Remove(key);
                return v;
            }
            else
                return default;
        }

        public static Dictionary<string, object> ParamHoisting(this Dictionary<string, object>? top, Dictionary<string, object> bottom, string? key = null)
        {
            Dictionary<string, object> dict;
            if (!string.IsNullOrEmpty(key))
            {
                dict = top?.GetConfig(key!) ?? [];
            }
            else
                dict = new Dictionary<string, object>(top ?? []);

            foreach (var item in bottom)
                if (!dict.ContainsKey(item.Key))
                    dict.Add(item.Key, item.Value);

            return dict;
        }
    }
}
