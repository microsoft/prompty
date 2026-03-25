// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI agents.
/// `provider`, `kind`, and `endpoint` are required properties here,
/// but this section can accept additional via options.
/// </summary>
public abstract class Connection
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
#pragma warning disable CS8618
    protected Connection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;

    /// <summary>
    /// The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')
    /// </summary>
    public string AuthenticationMode { get; set; } = "system";

    /// <summary>
    /// The usage description for the connection, providing context on how this connection will be used
    /// </summary>
    public string? UsageDescription { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a Connection instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Connection instance.</returns>
    public static Connection Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Load polymorphic Connection instance
        var instance = LoadKind(data, context);


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("authenticationMode", out var authenticationModeValue) && authenticationModeValue is not null)
        {
            instance.AuthenticationMode = authenticationModeValue?.ToString()!;
        }

        if (data.TryGetValue("usageDescription", out var usageDescriptionValue) && usageDescriptionValue is not null)
        {
            instance.UsageDescription = usageDescriptionValue?.ToString()!;
        }

        if (context is not null)
        {
            instance = context.ProcessOutput(instance);
        }
        return instance;
    }



    /// <summary>
    /// Load polymorphic Connection based on discriminator.
    /// </summary>
    private static Connection LoadKind(Dictionary<string, object?> data, LoadContext? context)
    {
        if (data.TryGetValue("kind", out var discriminatorValue) && discriminatorValue is not null)
        {
            var discriminator = discriminatorValue.ToString()?.ToLowerInvariant();
            return discriminator switch
            {
                "reference" => ReferenceConnection.Load(data, context),
                "remote" => RemoteConnection.Load(data, context),
                "key" => ApiKeyConnection.Load(data, context),
                "anonymous" => AnonymousConnection.Load(data, context),
                "foundry" => FoundryConnection.Load(data, context),
                "oauth" => OAuthConnection.Load(data, context),
                _ => throw new ArgumentException($"Unknown Connection discriminator value: {discriminator}"),
            };
        }

        throw new ArgumentException("Missing Connection discriminator property: 'kind'");

    }


    #endregion

    #region Save Methods

    /// <summary>
    /// Save the Connection instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public virtual Dictionary<string, object?> Save(SaveContext? context = null)
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

        if (obj.AuthenticationMode is not null)
        {
            result["authenticationMode"] = obj.AuthenticationMode;
        }

        if (obj.UsageDescription is not null)
        {
            result["usageDescription"] = obj.UsageDescription;
        }


        if (context is not null)
        {
            result = context.ProcessDict(result);
        }

        return result;
    }


    /// <summary>
    /// Convert the Connection instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the Connection instance to a JSON string.
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
    /// Load a Connection instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Connection instance.</returns>
    public static Connection FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a Connection instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded Connection instance.</returns>
    public static Connection FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
