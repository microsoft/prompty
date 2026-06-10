// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Resolves host permission requests for potentially sensitive actions.
/// </summary>
public interface IPermissionResolver
{
    /// <summary>
    /// Resolve a host permission request
    /// </summary>
    Task<PermissionDecision> RequestAsync(PermissionRequest request);
}
