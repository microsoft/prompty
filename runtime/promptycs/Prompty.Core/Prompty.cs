using System.Text.Json;
using YamlDotNet.Serialization;
using Microsoft.Extensions.FileSystemGlobbing;
using YamlDotNet.Serialization.NamingConventions;
using Microsoft.Extensions.FileSystemGlobbing.Abstractions;
using System.Diagnostics;
using System.Security.AccessControl;

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



        public static Prompty Load(string path, string configuration = "default")
        {
            string text = File.ReadAllText(path);
            var frontmatter = PromptyExtensions.LoadRaw(text, path, configuration);
            var prompty = frontmatter.ToPrompty(path);
            return prompty;
        }

        public static async Task<Prompty> LoadAsync(string path, string configuration = "default")
        {
            string text = await File.ReadAllTextAsync(path);
            var frontmatter = PromptyExtensions.LoadRaw(text, path, configuration);
            var prompty = frontmatter.ToPrompty(path);
            return prompty;
        }


        public static object Prepare(Prompty prompty, Dictionary<string, object>? inputs = null)
        {
            return prompty.Prepare(inputs);
        }

        public static async Task<object> PrepareAsync(Prompty prompty, Dictionary<string, object>? inputs = null)
        {
            return await prompty.PrepareAsync(inputs);
        }

        public static object Run(Prompty prompty, 
            object content, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            bool raw = false)
        {
            return prompty.Run(content, configuration, parameters, raw);
        }

        public static async Task<object> RunAsync(Prompty prompty, 
            object content, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            bool raw = false)
        {
            return await prompty.RunAsync(content, configuration, parameters, raw);
        }

        public static object Execute(Prompty prompt, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            Dictionary<string, object>? inputs = null, 
            bool raw = false)
        {
            return prompt.Execute(configuration, parameters, inputs, raw);
        }

        public static async Task<object> ExecuteAsync(Prompty prompt, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            Dictionary<string, object>? inputs = null, 
            bool raw = false)
        {
            return await prompt.ExecuteAsync(configuration, parameters, inputs, raw);
        }


        public static object Execute(string prompty,
            Dictionary<string, object>? configuration = null,
            Dictionary<string, object>? parameters = null,
            Dictionary<string, object>? inputs = null,
            string? config = "default",
            bool raw = false)
        {
            var prompt = Prompty.Load(prompty, config ?? "default");
            var result = prompt.Execute(configuration, parameters, inputs, raw);
            return result;
        }

        public static async Task<object> ExecuteAsync(string prompty,
            Dictionary<string, object>? configuration = null,
            Dictionary<string, object>? parameters = null,
            Dictionary<string, object>? inputs = null,
            string? config = "default",
            bool raw = false)
        {
            var prompt = await Prompty.LoadAsync(prompty, config ?? "default");
            var result = await prompt.ExecuteAsync(configuration, parameters, inputs, raw);
            return result;
        }
    }
}