using System.Linq;
using System.Text.RegularExpressions;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Prompty.Core
{
    public partial class Prompty
    {
        #region private
        private string? GetInvokerName(InvokerType type)
        {
            return type switch
            {
                InvokerType.Renderer => Template?.Format,
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

        private static Dictionary<string, object> LoadRaw(string promptyContent, Dictionary<string, object> global_config, string? path = null)
        {
            // parse the YAML frontmatter and content from the prompty template
            Match m = PromptyRegex().Match(promptyContent);
            if (!m.Success)
            {
                throw new ArgumentException("Invalid prompty template. Header and content could not be parsed.");
            }

            var header = m.Groups["header"].Value;
            if (string.IsNullOrEmpty(header))
            {
                throw new ArgumentException("Invalid prompty template. Header is empty.");
            }

            var content = m.Groups["content"].Value;
            if (string.IsNullOrEmpty(content))
            {
                throw new ArgumentException("Invalid prompty template. Content is empty.");
            }

            var deserializer = new DeserializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .Build();

            var frontmatter = deserializer.Deserialize<Dictionary<string, object>>(header);

            // frontmatter normalization
            if (path is not null)
            {
                frontmatter = Normalizer.Normalize(frontmatter, System.IO.Path.GetFullPath(path));
            }

            // model configuration hoisting
            if (!frontmatter.ContainsKey("model"))
                frontmatter["model"] = new Dictionary<string, object>();
            else
                frontmatter["model"] = frontmatter.GetValue<Dictionary<string, object>>("model") ?? [];

            var modelDict = ((Dictionary<string, object>)frontmatter["model"]);

            if (modelDict.TryGetValue("configuration", out object? value) && value.GetType() == typeof(Dictionary<string, object>))
                // param hoisting
                modelDict["configuration"] = ((Dictionary<string, object>)value).ParamHoisting(global_config);
            else
                // empty - use global configuration
                modelDict["configuration"] = global_config;

            frontmatter["content"] = content;

            return frontmatter;
        }
        private static Prompty Convert(Dictionary<string, object> frontmatter, string? path)
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
            // DEPRECAED
            //prompty.Sample = frontmatter.GetConfig("sample") ?? [];

            // properties
            prompty.Inputs = Property.CreatePropertyDictionary(frontmatter.GetConfig("inputs") ?? []);
            prompty.Outputs = Property.CreatePropertyDictionary(frontmatter.GetConfig("outputs") ?? []);

            // template
            prompty.Template = frontmatter.GetConfig("template", d => new Template(d)) ?? new Template(null);

            // internals
            prompty.Path = path is not null ? System.IO.Path.GetFullPath(path) : null;
            prompty.Content = frontmatter.GetValue<string>("content") ?? string.Empty;

            return prompty;
        }
        #endregion

        /// <summary>
        /// Load a prompty file using the provided file path.
        /// </summary>
        /// <param name="path">File path to the prompty file.</param>
        /// <param name="configuration">Id of the configuration to use.</param>
        public static Prompty Load(string path, string configuration = "default")
        {
            string text = File.ReadAllText(path);

            var global_config = GlobalConfig.Load(System.IO.Path.GetDirectoryName(path) ?? string.Empty, configuration) ?? [];
            global_config = Normalizer.Normalize(global_config, path);

            var frontmatter = LoadRaw(text, global_config, path);
            var prompty = Convert(frontmatter, path);
            return prompty;
        }

        /// <summary>
        /// Load a prompty file using the provided file path.
        /// </summary>
        /// <param name="path">File path to the prompty file.</param>
        /// <param name="configuration">Id of the configuration to use.</param>
        public static async Task<Prompty> LoadAsync(string path, string configuration = "default")
        {
            string text = await FileUtils.ReadAllTextAsync(path);

            var global_config = await GlobalConfig.LoadAsync(System.IO.Path.GetDirectoryName(path) ?? string.Empty, configuration) ?? [];
            global_config = Normalizer.Normalize(global_config, path);

            var frontmatter = LoadRaw(text, global_config, path);
            var prompty = Convert(frontmatter, path);
            return prompty;
        }

        /// <summary>
        /// Load a prompty file from a Stream
        /// </summary>
        /// <param name="stream">Stream to read the prompty file from.</param>
        /// <param name="configuration">Id of the configuration to use.</param>
        public static Prompty Load(Stream stream, string configuration = "default")
        {
            using var reader = new StreamReader(stream);
            string text = reader.ReadToEnd();

            var global_config = GlobalConfig.Load(System.IO.Path.GetDirectoryName(stream.ToString()) ?? string.Empty, configuration) ?? [];
            var streamPath = stream.ToString() ?? string.Empty;
            global_config = Normalizer.Normalize(global_config, streamPath);

            var frontmatter = LoadRaw(text, global_config, stream.ToString());
            var prompty = Convert(frontmatter, stream.ToString());
            return prompty;
        }

        /// <summary>
        /// Load a prompty file from a Stream Asynchronously
        /// </summary>
        /// <param name="stream">Stream to read the prompty file from.</param>
        /// <param name="configuration">Id of the configuration to use.</param>
        public static async Task<Prompty> LoadAsync(Stream stream, string configuration = "default")
        {
            using var reader = new StreamReader(stream);
            string text = await reader.ReadToEndAsync();

            var global_config = await GlobalConfig.LoadAsync(System.IO.Path.GetDirectoryName(stream.ToString()) ?? string.Empty, configuration) ?? [];
            var streamPath = stream.ToString() ?? string.Empty;
            global_config = Normalizer.Normalize(global_config, streamPath);

            var frontmatter = LoadRaw(text, global_config, stream.ToString());
            var prompty = Convert(frontmatter, stream.ToString());
            return prompty;
        }

        /// <summary>
        /// Load a prompty file using the provided text content.
        /// </summary>
        /// <param name="text">Id of the configuration to use.</param>
        /// <param name="gloablConfig">Global configuration to use.</param>
        /// <param name="path">Optional: File path to the prompty file.</param>
        public static Prompty Load(string text, Dictionary<string, object> globalConfig, string? path = null)
        {
            var parentPath = System.IO.Path.GetDirectoryName(path) ?? Directory.GetCurrentDirectory();

            var frontmatter = LoadRaw(text, globalConfig, parentPath);
            var prompty = Convert(frontmatter, path);
            return prompty;
        }


        //internal 

        public Dictionary<string, object> GetSample()
        {
            Dictionary<string, object> sample = new Dictionary<string, object>();
            foreach (var key in Inputs.Keys)
            {
                if (Inputs[key].Sample != null)
                    sample[key] = Inputs[key].Sample ?? "";
                else if (Inputs[key].Default != null)
                    sample[key] = Inputs[key].Default ?? "";
            }
            return sample;
        }

        internal Dictionary<string, object> ValidateInputs(object? inputs, bool mergeSample = false)
        {
            Dictionary<string, object> cleanInputs = new Dictionary<string, object>();

            if (inputs != null)
                cleanInputs = inputs.ToParamDictionary();
            
            if (mergeSample)
                cleanInputs = cleanInputs.ParamHoisting(GetSample());
            

            foreach (var key in Inputs.Keys)
                if (!cleanInputs.ContainsKey(key))
                    throw new Exception($"Missing required input '{key}'");

            return cleanInputs;
        }

        public object Prepare(object? inputs = null, bool mergeSample = false)
        {
            var resolvedInputs = ValidateInputs(inputs, mergeSample);
            object render = RunInvoker(InvokerType.Renderer, resolvedInputs, Content ?? "");
            object parsed = RunInvoker(InvokerType.Parser, render);
            return parsed;
        }

        public async Task<object> PrepareAsync(object? inputs = null, bool mergeSample = false)
        {
            var resolvedInputs = ValidateInputs(inputs, mergeSample);
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