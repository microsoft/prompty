// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

    /// <summary>
    /// Configuration for the agent loop's turn() function. Controls iteration
    /// 
    /// limits, retry policy, context management, and execution behavior.
    /// 
    /// Runtimes accept these as either a TurnOptions object or individual
    /// 
    /// keyword/named parameters — the TypeSpec model defines the canonical
    /// 
    /// field set.
    /// </summary>
public partial class TurnOptions
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="TurnOptions"/>.
    /// </summary>
#pragma warning disable CS8618
    public TurnOptions()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Maximum number of tool-call iterations before the loop terminates
    /// </summary>
    public int? MaxIterations { get; set; }

    /// <summary>
    /// Maximum number of LLM call retries on transient failure within a single iteration
    /// </summary>
    public int? MaxLlmRetries { get; set; }

    /// <summary>
    /// Character budget for the context window. When set, the loop trims older messages to stay within budget before each LLM call. System messages are never dropped.
    /// </summary>
    public int? ContextBudget { get; set; }

    /// <summary>
    /// Whether to execute multiple tool calls concurrently when the LLM returns several in one response
    /// </summary>
    public bool? ParallelToolCalls { get; set; }

    /// <summary>
    /// When true, return the raw LLM response without processor post-processing
    /// </summary>
    public bool? Raw { get; set; }

    /// <summary>
    /// Turn number for trace labeling. Useful when the caller maintains an outer conversation loop.
    /// </summary>
    public int? Turn { get; set; }

    /// <summary>
    /// Context compaction configuration. Controls how messages are summarized when the context window exceeds the budget.
    /// </summary>
    public CompactionConfig? Compaction { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a TurnOptions instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnOptions instance.</returns>
    public static TurnOptions Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new TurnOptions();


        if (data.TryGetValue("maxIterations", out var maxIterationsValue) && maxIterationsValue is not null)
        {
            instance.MaxIterations = Convert.ToInt32(maxIterationsValue);
        }

        if (data.TryGetValue("maxLlmRetries", out var maxLlmRetriesValue) && maxLlmRetriesValue is not null)
        {
            instance.MaxLlmRetries = Convert.ToInt32(maxLlmRetriesValue);
        }

        if (data.TryGetValue("contextBudget", out var contextBudgetValue) && contextBudgetValue is not null)
        {
            instance.ContextBudget = Convert.ToInt32(contextBudgetValue);
        }

        if (data.TryGetValue("parallelToolCalls", out var parallelToolCallsValue) && parallelToolCallsValue is not null)
        {
            instance.ParallelToolCalls = Convert.ToBoolean(parallelToolCallsValue);
        }

        if (data.TryGetValue("raw", out var rawValue) && rawValue is not null)
        {
            instance.Raw = Convert.ToBoolean(rawValue);
        }

        if (data.TryGetValue("turn", out var turnValue) && turnValue is not null)
        {
            instance.Turn = Convert.ToInt32(turnValue);
        }

        if (data.TryGetValue("compaction", out var compactionValue) && compactionValue is not null)
        {
            instance.Compaction = CompactionConfig.Load(compactionValue.GetDictionary(CompactionConfig.ShorthandProperty), context);
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
    /// Save the TurnOptions instance to a dictionary.
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


        if (obj.MaxIterations is not null)
        {
            result["maxIterations"] = obj.MaxIterations;
        }


        if (obj.MaxLlmRetries is not null)
        {
            result["maxLlmRetries"] = obj.MaxLlmRetries;
        }


        if (obj.ContextBudget is not null)
        {
            result["contextBudget"] = obj.ContextBudget;
        }


        if (obj.ParallelToolCalls is not null)
        {
            result["parallelToolCalls"] = obj.ParallelToolCalls;
        }


        if (obj.Raw is not null)
        {
            result["raw"] = obj.Raw;
        }


        if (obj.Turn is not null)
        {
            result["turn"] = obj.Turn;
        }


        if (obj.Compaction is not null)
        {
            result["compaction"] = obj.Compaction?.Save(context);
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the TurnOptions instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the TurnOptions instance to a JSON string.
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
    /// Load a TurnOptions instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnOptions instance.</returns>
    public static TurnOptions FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a TurnOptions instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded TurnOptions instance.</returns>
    public static TurnOptions FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
