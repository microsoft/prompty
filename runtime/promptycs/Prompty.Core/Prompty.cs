using System.Text.Json;
using YamlDotNet.Serialization;
using Microsoft.Extensions.FileSystemGlobbing;
using YamlDotNet.Serialization.NamingConventions;
using Microsoft.Extensions.FileSystemGlobbing.Abstractions;

namespace Prompty.Core
{
    public class Prompty
    {
        // metadata
        public string Name { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string[] Authors { get; set; } = [];
        public string[] Tags { get; set; } = [];
        public string Version { get; set; } = string.Empty;

        // base
        public string Base { get; set; } = string.Empty;
        public Prompty? BasePrompty { get; set; } = null;

        // model settings
        public Model? Model { get; set; } = null;

        // sample
        public Dictionary<string, object> Sample { get; set; } = [];

        // properties
        public Settings[] Inputs { get; set; } = [];
        public Settings[] Outputs { get; set; } = [];

        // template
        public Template? Template { get; set; } = null;

        // internals
        public string Path { get; set; } = string.Empty;
        public object Content { get; set; } = string.Empty;

        internal static async Task<Dictionary<string, object>> LoadGlobalConfigAsync(string path, string configuration = "default")
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
                var global_config = result.Files
                    .Where(f => System.IO.Path.GetDirectoryName(f.Path)?.Length <= path.Length)
                    .Select(f => f.Path)
                    .OrderByDescending(f => f.Length)
                    .First();

                string json = await File.ReadAllTextAsync(global_config);
                var config = JsonDocument.Parse(json).RootElement.ToDictionary();

                if (config != null && config.ContainsKey(configuration))
                    return config.GetValue<Dictionary<string, object>>(configuration) ?? [];
            }

            return [];

        }

        internal static Dictionary<string, object> LoadGlobalConfig(string path, string configuration = "default")
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
                var global_config = result.Files
                    .Where(f => System.IO.Path.GetDirectoryName(f.Path)?.Length <= path.Length)
                    .Select(f => f.Path)
                    .OrderByDescending(f => f.Length)
                    .First();

                string json = File.ReadAllText(global_config);
                var config = JsonDocument.Parse(json).RootElement.ToDictionary();

                if (config != null && config.ContainsKey(configuration))
                    return config.GetValue<Dictionary<string, object>>(configuration) ?? [];
            }

            return [];
        }

        public static Prompty Load(string path)
        {
            using StreamReader reader = new(path);
            string text = reader.ReadToEnd();
            var content = text.Split("---", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (content.Length != 2)
                throw new Exception("Invalida prompty format");

            var deserializer = new DeserializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .Build();

            var frontmatter = deserializer.Deserialize<Dictionary<string, object>>(content[0]);

            // frontmatter normalization 
            var parentPath = System.IO.Path.GetDirectoryName(path) ?? Directory.GetCurrentDirectory();
            frontmatter = Normalizer.Normalize(frontmatter, parentPath);

            // load global configuration
            var global_config = Normalizer.Normalize(
                LoadGlobalConfig(System.IO.Path.GetDirectoryName(path) ?? string.Empty) ?? [], parentPath);


            // model configuration hoisting
            if (!frontmatter.ContainsKey("model"))
                frontmatter["model"] = new Dictionary<string, object>();
            else
                frontmatter["model"] = frontmatter.GetValue<Dictionary<string, object>>("model") ?? [];


            var modelDict = ((Dictionary<string, object>)frontmatter["model"]);

            if (modelDict.ContainsKey("configuration") && modelDict["configuration"].GetType() == typeof(Dictionary<string, object>))
                // param hoisting
                modelDict["configuration"] = ((Dictionary<string, object>)modelDict["configuration"]).ParamHoisting(global_config);
            else
                // empty - use global configuration
                modelDict["configuration"] = global_config;

            Prompty prompty = new();

            // metadata
            prompty.Name = frontmatter.GetValue<string>("name") ?? string.Empty;
            prompty.Description = frontmatter.GetValue<string>("description") ?? string.Empty;
            prompty.Authors = frontmatter.GetList<string>("authors").ToArray();
            prompty.Tags = frontmatter.GetList<string>("tags").ToArray();
            prompty.Version = frontmatter.GetValue<string>("version") ?? string.Empty;

            // base
            prompty.Base = frontmatter.GetValue<string>("base") ?? string.Empty;

            // model settings from hoisted params
            prompty.Model = new Model(frontmatter.GetConfig("model") ?? []);

            // sample
            prompty.Sample = frontmatter.GetConfig("sample") ?? [];

            // properties
            prompty.Inputs = frontmatter.GetConfigList("inputs", d => new Settings(d)).ToArray();
            prompty.Outputs = frontmatter.GetConfigList("outputs", d => new Settings(d)).ToArray();

            // template
            prompty.Template = frontmatter.GetConfig("template", d => new Template(d)) ?? new Template
            {
                Type = "jinja2",
                Parser = "prompty"
            };

            // internals
            prompty.Path = System.IO.Path.GetFullPath(path);
            prompty.Content = content[1] ?? string.Empty;

            return prompty;
        }

        
    }
}