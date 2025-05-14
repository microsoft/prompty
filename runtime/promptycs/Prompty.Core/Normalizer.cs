using System.Text.Json;

namespace Prompty.Core
{
    public class Normalizer
    {
        public static Dictionary<string, object> Normalize(Dictionary<string, object> dict, string parentPath)
        {
            foreach (var key in dict.Keys)
                dict[key] = NormalizeValue(dict[key], parentPath);

            return dict;
        }

        internal static Dictionary<string, object> ProcessFile(string file, string parentPath)
        {
            var directory = File.Exists(parentPath) ? Path.GetDirectoryName(parentPath) : parentPath;
            var fullFile = FileUtils.GetFullPath(file, directory ?? string.Empty);
            if (File.Exists(fullFile))
            {
                string json = File.ReadAllText(fullFile);
                var config = JsonDocument.Parse(json).RootElement.ToDictionary();
                return Normalize(config, parentPath);
            }
            else
                throw new InvalidOperationException($"File {file} not found.");
        }

        internal static string? ProcessEnvironmentVariable(string variable, bool throwIfNotExists, string? defaultValue)
        {
            string? value = Environment.GetEnvironmentVariable(variable);
            if (value == null && throwIfNotExists && string.IsNullOrEmpty(defaultValue))
                throw new Exception($"Environment variable {variable} not found");
            else if (value == null)
                return defaultValue;
            else
                return value;
        }

        private static object NormalizeValue(object value, string parentPath)
        {
            switch (value)
            {
                // for handling special cases
                case string stringValue:
                    stringValue = stringValue.Trim();
                    if (stringValue.StartsWith("${") && stringValue.EndsWith("}"))
                    {
                        var subString = stringValue.Substring(2, stringValue.Length - 3);
                        var variable = subString.Split(':');
                        if (variable[0].ToLower() == "file" && variable.Length > 1)
                            return ProcessFile(variable[1], parentPath);
                        else if (variable[0].ToLower() == "env" && variable.Length > 1)
                            return ProcessEnvironmentVariable(variable[1], true, variable.Length >= 3 ? variable[2] : null) ?? "";
                    }


                    return stringValue;
                case List<object> listValue:
                    return listValue.Select(o => NormalizeValue(o, parentPath)).ToList();
                case Dictionary<string, object> dictStringValue:
                    return Normalize(dictStringValue, parentPath);
                case Dictionary<object, object> dictObjectValue:
                    return Normalize(dictObjectValue.ToConfig(), parentPath);
                default:
                    return value;
            }
        }
    }
}