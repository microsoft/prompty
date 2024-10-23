using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Prompty.Core
{
    public static class DictionaryExtensions
    {
        public static Prompty ToPrompty(this Dictionary<string, object> dict, string path)
        {
            return PromptyExtensions.FromDictionary(dict, path);
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
            return new Dictionary<string, object>(
                dict.Select(static item => new KeyValuePair<string, object>((string)item.Key, item.Value))
            );
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
                dict = top != null ? 
                    top.GetConfig(key) ?? new Dictionary<string, object>() :
                    new Dictionary<string, object>();
            else
                dict = new Dictionary<string, object>(top ?? []);

            foreach (var item in bottom)
                if (!dict.ContainsKey(item.Key))
                    dict.Add(item.Key, item.Value);

            return dict;
        }
    }
}
