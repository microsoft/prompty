// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Typed load-time error carrying a canonical <c>kind</c> (and optional <c>field</c>).
///
/// The <c>kind</c> is drawn from the cross-runtime load-error taxonomy
/// (<c>env_var_not_set</c>, <c>file_reference</c>, <c>invalid_frontmatter</c>,
/// <c>invalid_template</c>, ...), letting conformance adapters map a runtime failure to
/// the spec's <c>expectedError</c> by exception <em>type</em> — never by message
/// substring matching.
///
/// Subclasses <see cref="InvalidOperationException"/> for backward compatibility with
/// existing callers that catch that type from the loader.
/// </summary>
public sealed class PromptyLoadException : InvalidOperationException
{
    /// <summary>Canonical error kind (e.g. <c>env_var_not_set</c>).</summary>
    public string Kind { get; }

    /// <summary>Optional field name associated with the error (e.g. the missing input).</summary>
    public string? Field { get; }

    public PromptyLoadException(string kind, string message, string? field = null)
        : base(message)
    {
        Kind = kind;
        Field = field;
    }
}
