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
}
