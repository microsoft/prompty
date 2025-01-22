using System;
using System.Collections.Generic;
using System.Text.Json;
using System.IO;
using System.ComponentModel.DataAnnotations;

namespace Prompty.Core
{

    public class JsonConverter
    {
        public static Dictionary<string, object> ConvertJsonElementToDictionary(JsonElement jsonElement)
        {
            var dictionary = new Dictionary<string, object>();

            foreach (JsonProperty property in jsonElement.EnumerateObject())
            {
                dictionary[property.Name] = ConvertJsonValue(property.Value);
            }

            return dictionary;
        }

        private static object ConvertJsonValue(JsonElement jsonElement)
        {
            switch (jsonElement.ValueKind)
            {
                case JsonValueKind.Object:
                    return ConvertJsonElementToDictionary(jsonElement);
                case JsonValueKind.Array:
                    var list = new List<object>();
                    foreach (JsonElement element in jsonElement.EnumerateArray())
                    {
                        list.Add(ConvertJsonValue(element));
                    }
                    return list;
                case JsonValueKind.String:
                    return jsonElement.GetString() ?? "";
                case JsonValueKind.Number:
                    if (jsonElement.TryGetInt32(out int intValue))
                        return intValue;
                    if (jsonElement.TryGetInt64(out long longValue))
                        return longValue;
                    return jsonElement.GetDouble();
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
                case JsonValueKind.Null:
                    return "null";
                default:
                    throw new InvalidOperationException($"Unsupported JsonValueKind: {jsonElement.ValueKind}");
            }
        }
    }
}