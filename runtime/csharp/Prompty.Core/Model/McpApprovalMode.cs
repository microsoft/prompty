// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130

/// <summary>
/// The approval mode for MCP server tools.
/// When kind is &quot;specify&quot;, use alwaysRequireApprovalTools and neverRequireApprovalTools
/// to control per-tool approval. For &quot;always&quot; and &quot;never&quot;, those fields are ignored.
/// </summary>
public class McpApprovalMode
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => "kind";

    /// <summary>
    /// Initializes a new instance of <see cref="McpApprovalMode"/>.
    /// </summary>
#pragma warning disable CS8618
    public McpApprovalMode()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The approval mode: 'always', 'never', or 'specify'
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// List of tools that always require approval (only used when kind is 'specify')
    /// </summary>
    public IList<string>? AlwaysRequireApprovalTools { get; set; }

    /// <summary>
    /// List of tools that never require approval (only used when kind is 'specify')
    /// </summary>
    public IList<string>? NeverRequireApprovalTools { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a McpApprovalMode instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpApprovalMode instance.</returns>
    public static McpApprovalMode Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }

        // Note: Alternate (shorthand) representations are handled by the converter


        // Create new instance
        var instance = new McpApprovalMode();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("alwaysRequireApprovalTools", out var alwaysRequireApprovalToolsValue) && alwaysRequireApprovalToolsValue is not null)
        {
            instance.AlwaysRequireApprovalTools = (alwaysRequireApprovalToolsValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
        }

        if (data.TryGetValue("neverRequireApprovalTools", out var neverRequireApprovalToolsValue) && neverRequireApprovalToolsValue is not null)
        {
            instance.NeverRequireApprovalTools = (neverRequireApprovalToolsValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
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
    /// Save the McpApprovalMode instance to a dictionary.
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


        if (obj.Kind is not null)
        {
            result["kind"] = obj.Kind;
        }

        if (obj.AlwaysRequireApprovalTools is not null)
        {
            result["alwaysRequireApprovalTools"] = obj.AlwaysRequireApprovalTools;
        }

        if (obj.NeverRequireApprovalTools is not null)
        {
            result["neverRequireApprovalTools"] = obj.NeverRequireApprovalTools;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the McpApprovalMode instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the McpApprovalMode instance to a JSON string.
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
    /// Load a McpApprovalMode instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpApprovalMode instance.</returns>
    public static McpApprovalMode FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        // Handle alternate representations
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            var value = JsonUtils.GetJsonElementValue(doc.RootElement);
            dict = value switch
            {
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["kind"] = value
                }
            };
        }
        else
        {
            dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
                ?? throw new ArgumentException("Failed to parse JSON as dictionary");
        }

        return Load(dict, context);
    }

    /// <summary>
    /// Load a McpApprovalMode instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded McpApprovalMode instance.</returns>
    public static McpApprovalMode FromYaml(string yaml, LoadContext? context = null)
    {
        // Handle alternate representations - try object first, fall back to scalar
        Dictionary<string, object?>? dictResult = null;
        try
        {
            dictResult = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml);
        }
        catch (YamlDotNet.Core.YamlException)
        {
            // Not a dictionary, will be handled as scalar below
        }

        Dictionary<string, object?> dict;
        if (dictResult is not null)
        {
            dict = dictResult;
        }
        else
        {
            // Parse as scalar with proper type inference
            var parsed = YamlUtils.ParseScalar(yaml);
            dict = parsed switch
            {
                string stringValue => new Dictionary<string, object?>
                {
                    ["kind"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["kind"] = parsed
                }
            };
        }

        return Load(dict, context);
    }

    #endregion
}
