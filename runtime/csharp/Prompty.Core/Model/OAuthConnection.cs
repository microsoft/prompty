// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration using OAuth 2.0 client credentials.
/// Useful for tools and services that require OAuth authentication,
/// such as MCP servers, OpenAPI endpoints, or other REST APIs.
/// </summary>
public class OAuthConnection : Connection
{
    /// <summary>
    /// The shorthand property name for this type, if any.
    /// </summary>
    public new static string? ShorthandProperty => null;

    /// <summary>
    /// Initializes a new instance of <see cref="OAuthConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public OAuthConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The connection kind for OAuth authentication
    /// </summary>
    public override string Kind { get; set; } = "oauth";

    /// <summary>
    /// The endpoint URL for the service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client ID
    /// </summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client secret
    /// </summary>
    public string ClientSecret { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth token endpoint URL
    /// </summary>
    public string TokenUrl { get; set; } = string.Empty;

    /// <summary>
    /// OAuth scopes to request
    /// </summary>
    public IList<string>? Scopes { get; set; }


    #region Load Methods

    /// <summary>
    /// Load a OAuthConnection instance from a dictionary.
    /// </summary>
    /// <param name="data">The dictionary containing the data.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded OAuthConnection instance.</returns>
    public new static OAuthConnection Load(Dictionary<string, object?> data, LoadContext? context = null)
    {
        if (context is not null)
        {
            data = context.ProcessInput(data);
        }


        // Create new instance
        var instance = new OAuthConnection();


        if (data.TryGetValue("kind", out var kindValue) && kindValue is not null)
        {
            instance.Kind = kindValue?.ToString()!;
        }

        if (data.TryGetValue("endpoint", out var endpointValue) && endpointValue is not null)
        {
            instance.Endpoint = endpointValue?.ToString()!;
        }

        if (data.TryGetValue("clientId", out var clientIdValue) && clientIdValue is not null)
        {
            instance.ClientId = clientIdValue?.ToString()!;
        }

        if (data.TryGetValue("clientSecret", out var clientSecretValue) && clientSecretValue is not null)
        {
            instance.ClientSecret = clientSecretValue?.ToString()!;
        }

        if (data.TryGetValue("tokenUrl", out var tokenUrlValue) && tokenUrlValue is not null)
        {
            instance.TokenUrl = tokenUrlValue?.ToString()!;
        }

        if (data.TryGetValue("scopes", out var scopesValue) && scopesValue is not null)
        {
            instance.Scopes = (scopesValue as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];
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
    /// Save the OAuthConnection instance to a dictionary.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The dictionary representation of this instance.</returns>
    public override Dictionary<string, object?> Save(SaveContext? context = null)
    {
        var obj = this;
        if (context is not null)
        {
            obj = context.ProcessObject(obj);
        }


        // Start with parent class properties
        var result = base.Save(context);


        if (obj.Kind is not null)
        {
            result["kind"] = obj.Kind;
        }

        if (obj.Endpoint is not null)
        {
            result["endpoint"] = obj.Endpoint;
        }

        if (obj.ClientId is not null)
        {
            result["clientId"] = obj.ClientId;
        }

        if (obj.ClientSecret is not null)
        {
            result["clientSecret"] = obj.ClientSecret;
        }

        if (obj.TokenUrl is not null)
        {
            result["tokenUrl"] = obj.TokenUrl;
        }

        if (obj.Scopes is not null)
        {
            result["scopes"] = obj.Scopes;
        }


        return result;
    }


    /// <summary>
    /// Convert the OAuthConnection instance to a YAML string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The YAML string representation of this instance.</returns>
    public new string ToYaml(SaveContext? context = null)
    {
        context ??= new SaveContext();
        return context.ToYaml(Save(context));
    }

    /// <summary>
    /// Convert the OAuthConnection instance to a JSON string.
    /// </summary>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation of this instance.</returns>
    public new string ToJson(SaveContext? context = null, bool indent = true)
    {
        context ??= new SaveContext();
        return context.ToJson(Save(context), indent);
    }

    /// <summary>
    /// Load a OAuthConnection instance from a JSON string.
    /// </summary>
    /// <param name="json">The JSON string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded OAuthConnection instance.</returns>
    public new static OAuthConnection FromJson(string json, LoadContext? context = null)
    {
        using var doc = JsonDocument.Parse(json);
        Dictionary<string, object?> dict;
        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)
            ?? throw new ArgumentException("Failed to parse JSON as dictionary");

        return Load(dict, context);
    }

    /// <summary>
    /// Load a OAuthConnection instance from a YAML string.
    /// </summary>
    /// <param name="yaml">The YAML string to parse.</param>
    /// <param name="context">Optional context with pre/post processing callbacks.</param>
    /// <returns>The loaded OAuthConnection instance.</returns>
    public new static OAuthConnection FromYaml(string yaml, LoadContext? context = null)
    {
        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new ArgumentException("Failed to parse YAML as dictionary");

        return Load(dict, context);
    }

    #endregion
}
