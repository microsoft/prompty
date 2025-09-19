// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI agents.
/// `provider`, `kind`, and `endpoint` are required properties here,
/// but this section can accept additional via options.
/// </summary>
public class Connection
{
    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
    public Connection()
    {
    }
        
    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public virtual string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// The authority level for the connection, indicating under whose authority the connection is made (e.g., 'user', 'agent', 'system')
    /// </summary>
    public string Authority { get; set; } = string.Empty;
        
    /// <summary>
    /// The usage description for the connection, providing context on how this connection will be used
    /// </summary>
    public string? UsageDescription { get; set; }
        
    /// <summary>
    /// Additional options for the connection
    /// </summary>
    public IDictionary<string, object>? Options { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="Connection"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static Connection Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // load polymorphic Connection instance
        var instance = LoadKind(data);
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("authority", out var authorityValue))
        {
            instance.Authority = authorityValue as string ?? throw new ArgumentException("Properties must contain a property named: authority", nameof(props));
        }
        if (data.TryGetValue("usage_description", out var usage_descriptionValue))
        {
            instance.UsageDescription = usage_descriptionValue as string;
        }
        if (data.TryGetValue("options", out var optionsValue))
        {
            instance.Options = optionsValue as IDictionary<string, object>;
        }
        return instance;
    }
    
    
    /// <summary>
    /// Load a polymorphic instance of <see cref="Connection"/> based on the "kind" property.
    /// </summary>
    internal static Connection LoadKind(IDictionary<string, object> props)
    {
        // load polymorphic Connection instance from kind property
        if(props.ContainsKey("kind"))
        {
            var discriminator_value = props.GetValueOrDefault<string>("kind");
            if(discriminator_value == "reference")
            {
                return ReferenceConnection.Load(props);
            }
            else if (discriminator_value == "key")
            {
                return KeyConnection.Load(props);
            }
            else if (discriminator_value == "oauth")
            {
                return OAuthConnection.Load(props);
            }
            else if (discriminator_value == "foundry")
            {
                return FoundryConnection.Load(props);
            }
            else
            {
                return Load(props);
            }
        }
        else
        {
            throw new ArgumentException("Missing Connection discriminator property: 'kind'");
        }
    }
    
}
