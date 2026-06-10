// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// The result of a guardrail evaluation. Guardrails are safety checks that
///
/// run at specific phases of the agent loop and can allow, deny, or rewrite
///
/// content.
/// </summary>
public partial class GuardrailResult
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="GuardrailResult"/>.
    /// </summary>
#pragma warning disable CS8618
    public GuardrailResult()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// Whether the content passed the guardrail check
    /// </summary>
    public bool Allowed { get; set; } = false;

    /// <summary>
    /// Explanation of why the content was allowed or denied
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>
    /// Optional rewritten content to replace the original
    /// </summary>
    public object? Rewrite { get; set; }



    #region Load Methods

    /// <summary>
    /// Load a GuardrailResult instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded GuardrailResult instance.</returns>
    public static GuardrailResult Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new GuardrailResult();


        if (data.TryGetValue("allowed", out var allowedValue) && allowedValue is not null)
        {
            instance.Allowed = Convert.ToBoolean(allowedValue);
        }

        if (data.TryGetValue("reason", out var reasonValue) && reasonValue is not null)
        {
            instance.Reason = reasonValue?.ToString()!;
        }

        if (data.TryGetValue("rewrite", out var rewriteValue) && rewriteValue is not null)
        {
            instance.Rewrite = rewriteValue;
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
    /// Save the GuardrailResult instance to a dictionary.
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


        result["allowed"] = obj.Allowed;


        if (obj.Reason is not null)
        {
            result["reason"] = obj.Reason;
        }


        if (obj.Rewrite is not null)
        {
            result["rewrite"] = obj.Rewrite;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the GuardrailResult instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the GuardrailResult instance to a JSON string.
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
    /// Load a GuardrailResult instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded GuardrailResult instance.</returns>
    public static GuardrailResult FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a GuardrailResult instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded GuardrailResult instance.</returns>
    public static GuardrailResult FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion

    #region Factory Methods

    /// <summary>
    /// Create a GuardrailResult with preset field values.
    /// </summary>
    public static GuardrailResult CreateRewrite(object? rewrite)
    {
        return new GuardrailResult { Allowed = true, Rewrite = rewrite };
    }

    /// <summary>
    /// Create a GuardrailResult with preset field values.
    /// </summary>
    public static GuardrailResult Deny(string reason)
    {
        return new GuardrailResult { Allowed = false, Reason = reason };
    }

    /// <summary>
    /// Create a GuardrailResult with preset field values.
    /// </summary>
    public static GuardrailResult Allow()
    {
        return new GuardrailResult { Allowed = true };
    }

    #endregion
}
