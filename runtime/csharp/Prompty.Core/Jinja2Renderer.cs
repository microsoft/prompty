// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core.JinjaSubset;

namespace Prompty.Core;

/// <summary>
/// Renders Prompty templates using the owned Prompty Jinja Subset engine
/// (<see cref="Prompty.Core.JinjaSubset.Evaluator"/>). Registered under keys
/// "jinja" and "jinja2".
///
/// The subset is the portable contract every Prompty runtime renderer must
/// implement identically (spec/jinja-grammar.md); owning the tokenizer, parser,
/// and evaluator removes the cross-runtime divergences that third-party engines
/// introduced (e.g. Jinja2.NET dropping literal spaces inside for-loop bodies,
/// microsoft/prompty#492).
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

        var rendered = Evaluator.Render(template, safeInputs);
        return Task.FromResult(rendered);
    }
}

