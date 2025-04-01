using System.Collections;
using System.Reflection;
using System.Text.Json;

namespace Prompty.Core
{
    public static class DictionaryExtensions
    {
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

        public static Dictionary<string, object> ToParamDictionary(this object obj)
        {
            if (obj == null)
                return new Dictionary<string, object>();

            else if (obj is Dictionary<string, object>)
                return (Dictionary<string, object>)obj;

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


        public static Dictionary<string, object> ToDictionary(this JsonElement obj)
        {
            return JsonConverter.ConvertJsonElementToDictionary(obj);
        }
        public static T? GetValue<T>(this Dictionary<string, object> dict, string key)
        {
            // try to see if dictionary has key and can map to type
            if (dict.ContainsKey(key) && dict[key].GetType() == typeof(T))
                return (T)dict[key];
            else
                return default;

        }

        public static IEnumerable<T> GetList<T>(this Dictionary<string, object> dict, string key)
        {
            // try to see if dictionary has key and can map to type
            if (dict.ContainsKey(key) && dict[key].GetType() == typeof(List<object>))
            {
                var list = (List<object>)dict[key];
                if (list.Count > 0)
                    return list.Select(i => (T)i);
            }

            return [];
        }

        public static IEnumerable<T> GetList<S, T>(this Dictionary<string, object> dict, string key, Func<S, T> transform)
        {
            // try to see if dictionary has key and can map to type
            if (dict.ContainsKey(key) && dict[key].GetType() == typeof(List<object>))
            {
                var list = (List<object>)dict[key];
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
            if (dict.ContainsKey(key) && dict[key].GetType() == typeof(T))
            {
                var v = (T)dict[key];
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

        public static Dictionary<string, object> ParamPrimitiveConversion(this Dictionary<string, object> parameters)
        {
            foreach (var key in parameters.Keys)
            {
                var value = parameters[key] as string;
                if (value == null) continue;

                if (bool.TryParse(value, out bool boolValue))
                {
                    parameters[key] = boolValue;
                }
                else if (int.TryParse(value, out int intValue))
                {
                    parameters[key] = intValue;
                }
                else if (double.TryParse(value, out double doubleValue))
                {
                    parameters[key] = doubleValue;
                }
            }

            return parameters;
        }
    }
}
