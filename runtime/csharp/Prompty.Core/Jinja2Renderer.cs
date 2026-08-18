// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Renders Prompty templates using the Jinja2 template engine (via Jinja2.NET).
/// Registered under key "jinja2".
/// </summary>
public class Jinja2Renderer : IRenderer
{
    /// <summary>
    /// The most recently generated nonces from rendering, for thread expansion.
    /// </summary>
    public Dictionary<string, string> LastNonces { get; private set; } = [];

    public Task<string> RenderAsync(Agent agent, string template, Dictionary<string, object?> inputs)
    {
        var (renderInputs, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);
        LastNonces = nonces;

        // Strip prototype-chain escape hatches (__proto__, constructor, prototype)
        // before rendering — defense-in-depth against template injection, the C#
        // sibling of GHSA-w28w-gp39-m4p6 (see issue #432).
        var safeInputs = RenderHelpers.SanitizeInputs(renderInputs);

        // Jinja2.NET: create template and render with context
        var jinja = new Jinja2.NET.Template(template);

        // Convert to IDictionary<string, object> for Jinja2.NET (no nulls)
        var context = new Dictionary<string, object>();
        foreach (var kvp in safeInputs)
        {
            if (kvp.Value is not null)
                context[kvp.Key] = kvp.Value;
        }

        var rendered = jinja.Render(context);
        return Task.FromResult(rendered);
    }
}
