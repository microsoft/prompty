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

        private string? GetInvokerName(InvokerType type)
        {
            return type switch
            {
                InvokerType.Renderer => Template?.Type,
                InvokerType.Parser => $"{Template?.Parser}.{Model?.Api}",
                InvokerType.Executor => Model?.Configuration?.Type,
                InvokerType.Processor => Model?.Configuration?.Type,
                _ => throw new NotImplementedException(),
            };
        }

        private object RunInvoker(InvokerType type, object input, object? alt = null)
        {
            string? invokerType = GetInvokerName(type);

            if (invokerType == null)
                throw new Exception($"Invalid invoker type {invokerType}");

            if (invokerType == "NOOP")
                return input;

            var invoker = InvokerFactory.Instance.CreateInvoker(invokerType, type, this);
            if (invoker != null)
                return invoker.Invoke(input);

            if (alt != null)
                return alt;
            else
                return input;
        }

        private async Task<object> RunInvokerAsync(InvokerType type, object input, object? alt = null)
        {
            string? invokerType = GetInvokerName(type);

            if (invokerType == null)
                throw new Exception($"Invalid invoker type {invokerType}");

            if (invokerType == "NOOP")
                return input;

            var invoker = InvokerFactory.Instance.CreateInvoker(invokerType, type, this);
            if (invoker != null)
                return await invoker.InvokeAsync(input);

            if (alt != null)
                return alt;
            else
                return input;
        }

        private static Dictionary<string, object> LoadRaw(string promptyContent, string path, Dictionary<string, object> global_config)
        {
            var content = promptyContent.Split("---", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (content.Length != 2)
                throw new Exception("Invalida prompty format");

            var deserializer = new DeserializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .Build();

            var frontmatter = deserializer.Deserialize<Dictionary<string, object>>(content[0]);

            // frontmatter normalization 
            frontmatter = Normalizer.Normalize(frontmatter, path);


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

            frontmatter["content"] = content[1];

            return frontmatter;
        }

        private static Prompty Convert(Dictionary<string, object> frontmatter, string path)
        {
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
            prompty.Content = frontmatter.GetValue<string>("content") ?? string.Empty;

            return prompty;
        }

        public static Prompty Load(string path, string configuration = "default")
        {
            string text = File.ReadAllText(path);
            var parentPath = System.IO.Path.GetDirectoryName(path) ?? Directory.GetCurrentDirectory();

            var global_config = GlobalConfig.Load(System.IO.Path.GetDirectoryName(path) ?? string.Empty, configuration) ?? [];
            global_config = Normalizer.Normalize(global_config, path);

            var frontmatter = LoadRaw(text, parentPath, global_config);
            var prompty = Convert(frontmatter, path);
            return prompty;
        }

        public static async Task<Prompty> LoadAsync(string path, string configuration = "default")
        {
            string text = await File.ReadAllTextAsync(path);
            var parentPath = System.IO.Path.GetDirectoryName(path) ?? Directory.GetCurrentDirectory();

            var global_config = await GlobalConfig.LoadAsync(System.IO.Path.GetDirectoryName(path) ?? string.Empty, configuration) ?? [];
            global_config = Normalizer.Normalize(global_config, path);

            var frontmatter = LoadRaw(text, path, global_config);
            var prompty = Convert(frontmatter, path);
            return prompty;
        }


        public object Prepare(object? inputs = null)
        {
            var resolvedInputs = inputs != null ? inputs.ToParamDictionary().ParamHoisting(Sample ?? []) : Sample ?? [];
            object render = RunInvoker(InvokerType.Renderer, resolvedInputs, Content ?? "");
            object parsed = RunInvoker(InvokerType.Parser, render);
            return parsed;
        }

        public async Task<object> PrepareAsync(object? inputs = null)
        {
            var resolvedInputs = inputs != null ? inputs.ToParamDictionary().ParamHoisting(Sample ?? []) : Sample ?? [];
            object render = await RunInvokerAsync(InvokerType.Renderer, resolvedInputs, Content ?? "");
            object parsed = await RunInvokerAsync(InvokerType.Parser, render);
            return parsed;
        }

        public object Run(
            object content,
            object? configuration = null,
            object? parameters = null,
            bool raw = false)
        {
            if (configuration != null)
                Model!.Configuration = new Configuration(configuration.ToParamDictionary().ParamHoisting(Model?.Configuration.Items ?? []));

            if (parameters != null)
                Model!.Parameters = new Settings(parameters.ToParamDictionary().ParamHoisting(Model?.Parameters.Items ?? []));

            object executed = RunInvoker(InvokerType.Executor, content);

            if (raw)
                return executed;
            else
                return RunInvoker(InvokerType.Renderer, executed);
        }

        public async Task<object> RunAsync(
            object content,
            object? configuration = null,
            object? parameters = null,
            bool raw = false)
        {
            if (configuration != null)
                Model!.Configuration = new Configuration(configuration.ToParamDictionary().ParamHoisting(Model?.Configuration.Items ?? []));

            if (parameters != null)
                Model!.Parameters = new Settings(parameters.ToParamDictionary().ParamHoisting(Model?.Parameters.Items ?? []));

            object executed = await RunInvokerAsync(InvokerType.Executor, content);

            if (raw)
                return executed;
            else
                return await RunInvokerAsync(InvokerType.Renderer, executed);
        }

        public object Execute(
            object? configuration = null,
            object? parameters = null,
            object? inputs = null,
            bool raw = false)
        {
            var content = Prepare(inputs?.ToParamDictionary());
            var result = Run(content, configuration, parameters, raw);
            return result;
        }

        public async Task<object> ExecuteAsync(
            object? configuration = null,
            object? parameters = null,
            object? inputs = null,
            bool raw = false)
        {
            var content = await PrepareAsync(inputs?.ToParamDictionary());
            var result = await RunAsync(content, configuration, parameters, raw);
            return result;
        }


        public static object Execute(string prompty,
            object? configuration = null,
            object? parameters = null,
            object? inputs = null,
            string? config = "default",
            bool raw = false)
        {
            var prompt = Load(prompty, config ?? "default");
            var result = prompt.Execute(configuration, parameters, inputs, raw);
            return result;
        }

        public static async Task<object> ExecuteAsync(string prompty,
            object? configuration = null,
            object? parameters = null,
            object? inputs = null,
            string? config = "default",
            bool raw = false)
        {
            var prompt = await LoadAsync(prompty, config ?? "default");
            var result = await prompt.ExecuteAsync(configuration, parameters, inputs, raw);
            return result;
        }
    }
}