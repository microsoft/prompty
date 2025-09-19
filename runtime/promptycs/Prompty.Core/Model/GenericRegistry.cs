// Copyright (c) Microsoft. All rights reserved.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Definition for a generic container image registry.
/// </summary>
public class GenericRegistry : Registry
{
    /// <summary>
    /// Initializes a new instance of <see cref="GenericRegistry"/>.
    /// </summary>
    public GenericRegistry()
    {
    }
        
    /// <summary>
    /// The kind of container registry
    /// </summary>
    public override string Kind { get; set; } = string.Empty;
        
    /// <summary>
    /// The URL of the container registry
    /// </summary>
    public string Repository { get; set; } = string.Empty;
        
    /// <summary>
    /// The username for accessing the container registry
    /// </summary>
    public string? Username { get; set; }
        
    /// <summary>
    /// The password for accessing the container registry
    /// </summary>
    public string? Password { get; set; }
    

    /// <summary>
    /// Initializes a new instance of <see cref="GenericRegistry"/>.
    /// </summary>
    /// <param name="props">Properties for this instance.</param>
    internal static new GenericRegistry Load(object props)
    {
        IDictionary<string, object> data = props.ToParamDictionary();
        
        // create new instance
        var instance = new GenericRegistry();
        
        if (data.TryGetValue("kind", out var kindValue))
        {
            instance.Kind = kindValue as string ?? throw new ArgumentException("Properties must contain a property named: kind", nameof(props));
        }
        if (data.TryGetValue("repository", out var repositoryValue))
        {
            instance.Repository = repositoryValue as string ?? throw new ArgumentException("Properties must contain a property named: repository", nameof(props));
        }
        if (data.TryGetValue("username", out var usernameValue))
        {
            instance.Username = usernameValue as string;
        }
        if (data.TryGetValue("password", out var passwordValue))
        {
            instance.Password = passwordValue as string;
        }
        return instance;
    }
    
    
}
