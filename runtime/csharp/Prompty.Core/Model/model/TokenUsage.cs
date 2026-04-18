// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Tracks token consumption for a single LLM call. Provider-specific field
/// 
/// names (e.g., OpenAI's `prompt_tokens` vs Anthropic's `input_tokens`)
/// 
/// are mapped via `knownAs` augments in the wire directory.
/// </summary>
public partial class TokenUsage
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="TokenUsage"/>.
    /// </summary>
#pragma warning disable CS8618
    public TokenUsage()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Number of tokens in the prompt/input sent to the model
    /// </summary>
    public int? PromptTokens { get; set; }

    /// <summary>
    /// Number of tokens generated in the model's completion/output
    /// </summary>
    public int? CompletionTokens { get; set; }

    /// <summary>
    /// Total tokens consumed (prompt + completion). May be provided by the API or computed.
    /// </summary>
    public int? TotalTokens { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a TokenUsage instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TokenUsage instance.</returns>
    public static TokenUsage Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new TokenUsage();


        if (data.TryGetValue("promptTokens", out var promptTokensValue) && promptTokensValue is not null)
        {
            instance.PromptTokens = Convert.ToInt32(promptTokensValue);
        }

        if (data.TryGetValue("completionTokens", out var completionTokensValue) && completionTokensValue is not null)
        {
            instance.CompletionTokens = Convert.ToInt32(completionTokensValue);
        }

        if (data.TryGetValue("totalTokens", out var totalTokensValue) && totalTokensValue is not null)
        {
            instance.TotalTokens = Convert.ToInt32(totalTokensValue);
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the TokenUsage instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public Dictionary<string, object?> Save(SaveContext? context = null)
    {
        var obj = this;
        if (context is not null)
        {
            obj = context.ProcessObject(obj);
        }


        var result = new Dictionary<string, object?>();


        if (obj.PromptTokens is not null)
        {
            result["promptTokens"] = obj.PromptTokens;
        }


        if (obj.CompletionTokens is not null)
        {
            result["completionTokens"] = obj.CompletionTokens;
        }


        if (obj.TotalTokens is not null)
        {
            result["totalTokens"] = obj.TotalTokens;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }

    /// <summary>
    /// Convert this instance to a provider-specific wire-format dictionary.
    /// </summary>
    /// <param name="provider">The provider name (e.g., "openai", "anthropic").</param>
    /// <returns>A dictionary with provider-specific field names.</returns>
    public Dictionary<string, object?> ToWire(string provider)
    {
        var data = Save();
        var result = new Dictionary<string, object?>();
        var wireMap = new Dictionary<string, Dictionary<string, string>>
        {
            ["promptTokens"] = new Dictionary<string, string> { ["openai"] = "prompt_tokens", ["anthropic"] = "input_tokens" },
            ["completionTokens"] = new Dictionary<string, string> { ["openai"] = "completion_tokens", ["anthropic"] = "output_tokens" },
            ["totalTokens"] = new Dictionary<string, string> { ["openai"] = "total_tokens" },
        };
        foreach (var (key, value) in data)
        {
            if (wireMap.TryGetValue(key, out var mapping) && mapping.TryGetValue(provider, out var wireName))
                result[wireName] = value;
        }
        return result;
    }


    /// <summary>
    /// Convert the TokenUsage instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the TokenUsage instance to a JSON string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation of this instance.</returns>
    public string ToJson(SaveContext? context = null, bool indent = true)
    {
        context ??= new SaveContext();
        return context.ToJson(Save(context), indent);
    }

    /// <summary>
    /// Load a TokenUsage instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TokenUsage instance.</returns>
    public static TokenUsage FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a TokenUsage instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TokenUsage instance.</returns>
    public static TokenUsage FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
