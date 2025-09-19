using Microsoft.Extensions.FileSystemGlobbing;
using Microsoft.Extensions.FileSystemGlobbing.Abstractions;
using System.Text.Json;

namespace Prompty.Core
{
    internal static class GlobalConfig
    {
        private static string Find(string path)
        {
            if (string.IsNullOrEmpty(path))
                path = Directory.GetCurrentDirectory();

            Matcher matcher = new();
            matcher.AddInclude("**/prompty.json");

            var result = matcher.Execute(
                new DirectoryInfoWrapper(
                    new DirectoryInfo(Directory.GetCurrentDirectory())));

            if (result.HasMatches)
            {
                return result.Files
                    .Where(f => Path.GetDirectoryName(f.Path)?.Length <= path.Length)
                    .Select(f => f.Path)
                    .OrderByDescending(f => f.Length)
                    .First();
            }

            return string.Empty;
        }

        private static Dictionary<string, object> ParseJson(string json, string configuration)
        {
            var config = JsonDocument.Parse(json).RootElement.ToDictionary();
            if (config != null && config.ContainsKey(configuration))
                return config.GetValue<Dictionary<string, object>>(configuration) ?? [];
            else
                return [];
        }

        internal static async Task<Dictionary<string, object>> LoadAsync(string path, string configuration = "default")
        {
            var global_config = Find(path);
            if (!string.IsNullOrEmpty(global_config))
            {
                string json = await FileUtils.ReadAllTextAsync(global_config);
                return ParseJson(json, configuration);
            }

            return [];

        }

        internal static Dictionary<string, object> Load(string path, string configuration = "default")
        {
            var global_config = Find(path);
            if (!string.IsNullOrEmpty(global_config))
            {
                string json = File.ReadAllText(global_config);
                return ParseJson(json, configuration);
            }

            return [];
        }
    }
}
