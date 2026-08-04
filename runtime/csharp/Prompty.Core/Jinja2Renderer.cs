// Copyright (c) Microsoft. All rights reserved.

using System.Text.RegularExpressions;

namespace Prompty.Core;

/// <summary>
/// Renders Prompty templates using the Jinja2 template engine (via Jinja2.NET).
/// Registered under key "jinja2".
/// </summary>
public partial class Jinja2Renderer : IRenderer
{
    private const string ProtectedWhitespace = "__PROMPTY_JINJA_CONTROL_WHITESPACE__";

    [GeneratedRegex(@"[ \t]+(?=\{%\s*endfor\s*%\})")]
    private static partial Regex LoopBoundaryWhitespaceRegex();

    /// <summary>
    /// The most recently generated nonces from rendering, for thread expansion.
    /// </summary>
    public Dictionary<string, string> LastNonces { get; private set; } = [];

    public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
    {
        var (renderInputs, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);
        LastNonces = nonces;

        // Jinja2.NET: create template and render with context
        var protectedTemplate = LoopBoundaryWhitespaceRegex().Replace(
            template,
            match => string.Concat(Enumerable.Repeat(ProtectedWhitespace, match.Length)));
        var jinja = new Jinja2.NET.Template(protectedTemplate);

        // Convert to IDictionary<string, object> for Jinja2.NET (no nulls)
        var context = new Dictionary<string, object>();
        foreach (var kvp in renderInputs)
        {
            if (kvp.Value is not null)
                context[kvp.Key] = kvp.Value;
        }

        var rendered = jinja.Render(context).Replace(ProtectedWhitespace, " ", StringComparison.Ordinal);
        return Task.FromResult(rendered);
    }
}
