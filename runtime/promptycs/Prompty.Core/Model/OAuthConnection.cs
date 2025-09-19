// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using OAuth authentication.
/// </summary>
public class OAuthConnection : Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="OAuthConnection"/>.
    /// </summary>
    public OAuthConnection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "oauth";
        
    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;
        
    /// <summary>
    /// The OAuth client ID for authenticating with the AI service
    /// </summary>
    public string ClientId { get; set; } = string.Empty;
        
    /// <summary>
    /// The OAuth client secret for authenticating with the AI service
    /// </summary>
    public string ClientSecret { get; set; } = string.Empty;
        
    /// <summary>
    /// The OAuth token URL for obtaining access tokens
    /// </summary>
    public string TokenUrl { get; set; } = string.Empty;
        
    /// <summary>
    /// The scopes required for the OAuth token
    /// </summary>
    public IList<string> Scopes { get; set; } = [];
    

    /// <summary>
    /// Initializes a new instance of <see cref="OAuthConnection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new OAuthConnection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new OAuthConnection();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("endpoint", out var endpointValue))
        {
            instance.Endpoint = endpointValue as string ?? throw new ArgumentException("Properties must contain a property named: endpoint", nameof(props));
        }
        if (data.TryGetValue("clientId", out var clientIdValue))
        {
            instance.ClientId = clientIdValue as string ?? throw new ArgumentException("Properties must contain a property named: clientId", nameof(props));
        }
        if (data.TryGetValue("clientSecret", out var clientSecretValue))
        {
            instance.ClientSecret = clientSecretValue as string ?? throw new ArgumentException("Properties must contain a property named: clientSecret", nameof(props));
        }
        if (data.TryGetValue("tokenUrl", out var tokenUrlValue))
        {
            instance.TokenUrl = tokenUrlValue as string ?? throw new ArgumentException("Properties must contain a property named: tokenUrl", nameof(props));
        }
        if (data.TryGetValue("scopes", out var scopesValue))
        {
            instance.Scopes = scopesValue as IList<string> ?? throw new ArgumentException("Properties must contain a property named: scopes", nameof(props));
        }
        return instance;
    }
    
    
}
