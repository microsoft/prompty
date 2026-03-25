// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Model for defining the structure and behavior of AI agents.
/// This model includes properties for specifying the model&#39;s provider, connection details, and various options.
/// It allows for flexible configuration of AI models to suit different use cases and requirements.
/// </summary>
public class Model
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => "id";

    /// <summary>
    /// Initializes a new instance of <see cref="Model"/>.
    /// </summary>
#pragma warning disable CS8618
    public Model()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The unique identifier of the model - can be used as the single property shorthand
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// The provider of the model (e.g., 'openai', 'azure', 'anthropic')
    /// </summary>
    public string? Provider { get; set; }

    /// <summary>
    /// The type of API to use for the model (e.g., 'chat', 'response', etc.)
    /// </summary>
    public string? ApiType { get; set; }

    /// <summary>
    /// The connection configuration for the model
    /// </summary>
    public Connection? Connection { get; set; }

    /// <summary>
    /// Additional options for the model
    /// </summary>
    public ModelOptions? Options { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Model instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Model instance.</returns>
    public static Model Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }

        // Note: Alternate (shorthand) representations are handled by the converter


        // Create new instance
        var instance = new Model();


        if (data.TryGetValue("id", out var idValue) && idValue is not null)
        {
            instance.Id = idValue?.ToString()!;
        }

        if (data.TryGetValue("provider", out var providerValue) && providerValue is not null)
        {
            instance.Provider = providerValue?.ToString()!;
        }

        if (data.TryGetValue("apiType", out var apiTypeValue) && apiTypeValue is not null)
        {
            instance.ApiType = apiTypeValue?.ToString()!;
        }

        if (data.TryGetValue("connection", out var connectionValue) && connectionValue is not null)
        {
            instance.Connection = Connection.Load(connectionValue.GetDictionary(), context);
        }

        if (data.TryGetValue("options", out var optionsValue) && optionsValue is not null)
        {
            instance.Options = ModelOptions.Load(optionsValue.GetDictionary(), context);
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
    /// Save the Model instance to a dictionary.
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


        if (obj.Id is not null)
        {
            result["id"] = obj.Id;
        }

        if (obj.Provider is not null)
        {
            result["provider"] = obj.Provider;
        }

        if (obj.ApiType is not null)
        {
            result["apiType"] = obj.ApiType;
        }

        if (obj.Connection is not null)
        {
            result["connection"] = obj.Connection?.Save(context);
        }

        if (obj.Options is not null)
        {
            result["options"] = obj.Options?.Save(context);
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the Model instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Model instance to a JSON string.
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
    /// Load a Model instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Model instance.</returns>
    public static Model FromJson(string json, LoadContext? context = null)
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
                    ["id"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["id"] = value
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
    /// Load a Model instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Model instance.</returns>
    public static Model FromYaml(string yaml, LoadContext? context = null)
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
                    ["id"] = stringValue,
                },
                _ => new Dictionary<string, object?>
                {
                    ["id"] = parsed
                }
            };
        }

        return Load(dict, context);
    }

    #endregion
}
