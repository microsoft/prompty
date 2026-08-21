// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core.JinjaSubset;

/// <summary>
/// Raised when a template cannot be tokenized or parsed under the Prompty Jinja
/// Subset grammar (spec/jinja-grammar.md §2–§4).
/// </summary>
public sealed class TemplateSyntaxException : Exception
{
    public TemplateSyntaxException(string message) : base(message) { }
}

/// <summary>
/// Raised when a <c>strict</c> input value violates a structural invariant —
/// notably when an interpolated strict property forges a role boundary
/// (spec/jinja-grammar.md §8.4). Fail-closed: the render is rejected loudly
/// rather than emitting the forged content.
/// </summary>
public sealed class StrictViolationException : Exception
{
    public StrictViolationException(string message) : base(message) { }
}
