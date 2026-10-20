// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Options for loading .prompty files.
/// </summary>
public sealed class PromptyLoadOptions
{
    /// <summary>
    /// Additional directories that ${file:...} references may read from.
    /// The prompt file's directory is always allowed.
    /// </summary>
    public IEnumerable<string> AllowedFileRoots { get; init; } = [];

    /// <summary>
    /// Additional origins (e.g. <c>http://localhost:11434</c>, <c>https://*.contoso.com</c>)
    /// trusted to receive ambient credentials (spec §2.5.1). Unioned with the built-in
    /// provider origins and the <c>PROMPTY_TRUSTED_ENDPOINTS</c> env var; <c>"*"</c> trusts all.
    /// </summary>
    public IEnumerable<string> TrustedEndpoints { get; init; } = [];
}
