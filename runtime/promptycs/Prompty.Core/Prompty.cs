using System.Text.RegularExpressions;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Prompty.Core;

/// <summary>
/// Defines a Prompty template which can be used to represent a prompt template or an agent template.
/// </summary>
public partial class Prompty
{
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
        if (Inputs is null)
            return sample;

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
        if (configuration is not null && parameters is not null && Model is null)
        {
            this.Model = new Model();
        }

        if (configuration is not null)
        {
            Model!.Connection = new()
            {
                Type = Model?.Connection?.Type,
                ServiceId = Model?.Connection?.ServiceId,
                ExtensionData = configuration.ToParamDictionary().ParamHoisting(Model?.Connection?.ExtensionData ?? [])
            };
        }

        if (parameters is not null)
        {
            Model!.Options = parameters.ToParamDictionary().ParamHoisting(Model?.Options ?? []);
        }

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
        if (configuration is not null && parameters is not null && Model is null)
        {
            this.Model = new Model();
        }

        if (configuration is not null)
        {
            Model!.Connection = new()
            {
                Type = Model?.Connection?.Type,
                ServiceId = Model?.Connection?.ServiceId,
                ExtensionData = configuration.ToParamDictionary().ParamHoisting(Model?.Connection?.ExtensionData ?? [])
            };
        }

        if (parameters is not null)
        {
            Model!.Options = parameters.ToParamDictionary().ParamHoisting(Model?.Options ?? []);
        }

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

    #region private
    private string? GetInvokerName(InvokerType type)
    {
        return type switch
        {
            InvokerType.Renderer => Template?.Format,
            InvokerType.Parser => $"{Template?.Parser}.{Model?.Api}",
            InvokerType.Executor => Model?.Connection?.Type,
            InvokerType.Processor => Model?.Connection?.Type,
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
        Prompty prompty = new()
        {
            // metadata
            Id = frontmatter.GetValue<string>("id"),
            Version = frontmatter.GetValue<string>("version") ?? string.Empty,
            Name = frontmatter.GetValue<string>("name") ?? string.Empty,
            Description = frontmatter.GetValue<string>("description") ?? string.Empty,
            Metadata = ConvertToMetadata(frontmatter),

            // model settings from hoisted params
            Model = ConvertToModel(frontmatter.GetValue<Dictionary<string, object>>("model")),

            // properties
            Inputs = ConvertToInputs(frontmatter.GetValue<Dictionary<string, object>>("inputs")),
            Outputs = ConvertToOutputs(frontmatter.GetValue<object>("outputs")),

            // template
            Template = ConvertToTemplate(frontmatter.GetConfig("template")),

            // tools
            Tools = ConvertToTools(frontmatter.GetList<Dictionary<string, object>>("tools")),

            // base
            Base = frontmatter.GetValue<string>("base") ?? string.Empty,

            // internals
            Path = path is not null ? System.IO.Path.GetFullPath(path) : null,
            Content = frontmatter.GetValue<string>("content") ?? string.Empty
        };

        return prompty;
    }

    private static Metadata? ConvertToMetadata(Dictionary<string, object> frontmatter)
    {
        var dictionary = frontmatter.GetConfig("metadata");

        if (dictionary == null)
        {
            return new()
            {
                Authors = [.. frontmatter.GetList<string>("authors")],
                Tags = [.. frontmatter.GetList<string>("tags")]
            };
        }

        return new()
        {
            Authors = [.. dictionary.GetList<string>("authors")],
            Tags = [.. dictionary.GetList<string>("tags")]
        };
    }

    private static Model? ConvertToModel(Dictionary<string, object>? dictionary)
    {
        if (dictionary == null)
            return null;

        var options = dictionary.GetConfig("options") ?? dictionary.GetConfig("parameters") ?? [];
        var modelId = options.GetValue<string>("model_id");

        return new()
        {
            Id = dictionary.GetValue<string>("id") ?? modelId,
            Api = dictionary.GetValue<string>("api") ?? Model.DefaultApi,
            Options = options,
            Connection = ConvertToConnection(dictionary)
        };
    }

    private static Connection? ConvertToConnection(Dictionary<string, object> model)
    {
        var dictionary = model.GetConfig("connection");
        if (dictionary is null)
        {
            dictionary = model.GetConfig("configuration");
        }
        if (dictionary is null)
        {
            return null;
        }

        return new()
        {
            Type = dictionary.GetValue<string>("type"),
            ServiceId = dictionary.GetValue<string>("service_id"),
            ExtensionData = dictionary.Where(kvp => kvp.Key != "type" && kvp.Key != "service_id").ToDictionary(kvp => kvp.Key, kvp => kvp.Value)
        };
    }

    private static IDictionary<string, Input> ConvertToInputs(Dictionary<string, object>? dictionary)
    {
        var inputs = new Dictionary<string, Input>();
        if (dictionary == null)
            return inputs;

        foreach (var kvp in dictionary)
        {
            Input input = CreateInput(kvp.Key, kvp.Value);
            inputs[kvp.Key] = input;
        }

        return inputs;
    }

    private static Input CreateInput(string name, object value)
    {
        if (value == null)
            return new() { Name = name };

        if (value is Dictionary<string, object> dictionary)
        {
            // check is this a input definition
            if (IsInput(dictionary))
            {
                var propertyType = Property.GetPropertyType(dictionary);

                return new()
                {
                    Name = name,
                    Type = propertyType,
                    Description = dictionary.GetValue<string>("description"),
                    Default = Property.GetPropertyValue(propertyType, dictionary.GetValue<object>("default")),
                    Sample = Property.GetPropertyValue(propertyType, dictionary.GetValue<object>("sample")),
                    Required = dictionary.GetValue<bool>("required", true),
                    Strict = dictionary.GetValue<bool>("strict", true),
                    JsonSchema = dictionary.GetValue<object>("json_schema"),
                };
            }
        }

        return new()
        {
            Name = name,
            Type = Property.GetPropertyTypeFromValue(value),
            Sample = value
        };
    }

    private static bool IsInput(Dictionary<string, object> dictionary)
    {
        // TODO - Check do we want to maintain this behavior, the down-side is you cannot define a sparse input.
        // The alternative would be to disallow using Dictionaries with the shorthand sample setting syntax.
        string[] props = { "type", "default", "sample", "description" };
        return dictionary.Keys.Any(k => props.Contains(k));
    }

    private static IDictionary<string, Output>? ConvertToOutputs(object? value)
    {
        var outputs = new Dictionary<string, Output>();
        if (value == null)
            return outputs;

        if (value is Dictionary<string, object> dictionary)
        {
            if (dictionary == null)
                return outputs;

            foreach (var kvp in dictionary)
            {
                var outputDict = dictionary.GetConfig(kvp.Key);
                Output output = CreateOutput(kvp.Key, outputDict);
                outputs[kvp.Key] = output;
            }
        }
        else if (value is IEnumerable<object> list)
        {
            foreach (var item in list)
            {
                if (item is Dictionary<string, object> outputDict)
                {
                    var name = outputDict["name"] as string ?? throw new ArgumentException("Output name is required");
                    Output output = CreateOutput(name, outputDict);
                    outputs[name] = output;
                }
            }
        }
        else
        {
            throw new ArgumentException("Outputs must be a dictionary or a list of dictionaries");
        }

        return outputs;
    }

    private static Output CreateOutput(string name, Dictionary<string, object>? value)
    {
        if (value == null)
            return new() { Name = name };

        return new()
        {
            Type = Property.GetPropertyType(value),
            Name = name,
            Description = value?.GetValue<string>("description"),
            JsonSchema = value?.GetValue<object>("json_schema"),
        };
    }

    private static Template ConvertToTemplate(Dictionary<string, object>? dictionary)
    {
        if (dictionary == null)
            return new Template();

        return new()
        {
            Format = dictionary.GetValue<string>("format") ?? Template.DefaultFormat,
            Parser = dictionary.GetValue<string>("parser") ?? Template.DefaultParser,
        };
    }

    private static List<Tool>? ConvertToTools(IEnumerable<Dictionary<string, object>>? list)
    {
        List<Tool> tools = [];
        if (list == null)
            return tools;

        foreach (var item in list)
        {
            var tool = new Tool()
            {
                Id = item.GetValue<string>("id"),
                Description = item.GetValue<string>("description"),
                Type = item.GetValue<string>("type"),
                Options = item.GetConfig("options")?.ToDictionary(kvp => kvp.Key, kvp => (object?)kvp.Value)
            };
            tools.Add(tool);
        }

        return tools;
    }
    #endregion
}