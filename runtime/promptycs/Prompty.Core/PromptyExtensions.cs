using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using YamlDotNet.Serialization.NamingConventions;
using YamlDotNet.Serialization;
using static System.Net.Mime.MediaTypeNames;
using Scriban.Syntax;

namespace Prompty.Core
{
    public static class PromptyExtensions
    {
        internal static Dictionary<string, object> LoadRaw(string promptyContent, string path, string configuration = "default")
        {
            var content = promptyContent.Split("---", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
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
                GlobalConfig.Load(System.IO.Path.GetDirectoryName(path) ?? string.Empty) ?? [], parentPath);


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

        internal static Prompty FromDictionary(Dictionary<string, object> frontmatter, string path)
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
            prompty.Path = Path.GetFullPath(path);
            prompty.Content = frontmatter.GetValue<string>("content") ?? string.Empty;

            return prompty;
        }


        private static string? GetInvokerName(Prompty prompty, InvokerType type)
        {
            return type switch
            {
                InvokerType.Renderer => prompty?.Template?.Type,
                InvokerType.Parser => $"{prompty?.Template?.Parser}.{prompty?.Model?.Api}",
                InvokerType.Executor => prompty?.Model?.Configuration?.Type,
                InvokerType.Processor => prompty?.Model?.Configuration?.Type,
                _ => throw new NotImplementedException(),
            };
        }

        private static object RunInvoker(Prompty prompty, InvokerType type, object input, object? alt = null)
        {
            string? invokerType = GetInvokerName(prompty, type);

            if (invokerType == null)
                throw new Exception($"Invalid invoker type {invokerType}");

            if (invokerType == "NOOP")
                return input;

            var invoker = InvokerFactory.Instance.CreateInvoker(invokerType, type, prompty!);
            if (invoker != null)
                return invoker.Invoke(input);

            if (alt != null)
                return alt;
            else
                return input;
        }

        private static async Task<object> RunInvokerAsync(Prompty prompty, InvokerType type, object input, object? alt = null)
        {
            string? invokerType = GetInvokerName(prompty, type);

            if (invokerType == null)
                throw new Exception($"Invalid invoker type {invokerType}");

            if (invokerType == "NOOP")
                return input;

            var invoker = InvokerFactory.Instance.CreateInvoker(invokerType, type, prompty!);
            if (invoker != null)
                return await invoker.InvokeAsync(input);

            if (alt != null)
                return alt;
            else
                return input;
        }


        public static object Prepare(this Prompty prompt, Dictionary<string, object>? inputs = null)
        {
            var resolvedInputs = inputs != null ? inputs.ParamHoisting(prompt.Sample ?? []) : prompt.Sample ?? [];
            object render = RunInvoker(prompt!, InvokerType.Renderer, resolvedInputs, prompt?.Content ?? "");
            object parsed = RunInvoker(prompt!, InvokerType.Parser, render);
            return parsed;
        }

        public static async Task<object> PrepareAsync(this Prompty prompt, Dictionary<string, object>? inputs = null)
        {
            var resolvedInputs = inputs != null ? inputs.ParamHoisting(prompt.Sample ?? []) : prompt.Sample ?? [];
            object render = await RunInvokerAsync(prompt!, InvokerType.Renderer, resolvedInputs, prompt?.Content ?? "");
            object parsed = await RunInvokerAsync(prompt!, InvokerType.Parser, render);
            return parsed;
        }

        public static object Run(this Prompty prompt, 
            object content, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            bool raw = false)
        {
            if (configuration != null)
                prompt.Model!.Configuration = new Configuration(configuration.ParamHoisting(prompt!.Model?.Configuration.Items ?? []));

            if (parameters != null)
                prompt.Model!.Parameters = new Settings(parameters.ParamHoisting(prompt!.Model?.Parameters.Items ?? []));

            object executed = RunInvoker(prompt!, InvokerType.Executor, content);

            if (raw)
                return executed;
            else
                return RunInvoker(prompt!, InvokerType.Renderer, executed);
        }

        public static async Task<object> RunAsync(this Prompty prompt, 
            object content, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            bool raw = false)
        {
            if (configuration != null)
                prompt.Model!.Configuration = new Configuration(configuration.ParamHoisting(prompt!.Model?.Configuration.Items ?? []));

            if (parameters != null)
                prompt.Model!.Parameters = new Settings(parameters.ParamHoisting(prompt!.Model?.Parameters.Items ?? []));

            object executed = await RunInvokerAsync(prompt!, InvokerType.Executor, content);

            if (raw)
                return executed;
            else
                return await RunInvokerAsync(prompt!, InvokerType.Renderer, executed);
        }

        public static object Execute(this Prompty prompt, 
            Dictionary<string, object>? configuration = null, 
            Dictionary<string, object>? parameters = null, 
            Dictionary<string, object>? inputs = null, 
            bool raw = false)
        {
            var content = prompt.Prepare(inputs);
            var result = prompt.Run(content, configuration, parameters, raw);
            return result;
        }

        public static async Task<object> ExecuteAsync(this Prompty prompt,
            Dictionary<string, object>? configuration = null,
            Dictionary<string, object>? parameters = null,
            Dictionary<string, object>? inputs = null,
            bool raw = false)
        {
            var content = await prompt.PrepareAsync(inputs);
            var result = await prompt.RunAsync(content, configuration, parameters, raw);
            return result;
        }
    }
}
