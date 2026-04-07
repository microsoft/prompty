// Copyright (c) Microsoft. All rights reserved.

using Stubble.Core;
using Stubble.Core.Builders;

namespace Prompty.Core;

/// <summary>
/// Renders Prompty templates using the Mustache template engine (via Stubble.Core).
/// Registered under key "mustache".
/// </summary>
public class MustacheRenderer : IRenderer
{
    private static readonly StubbleVisitorRenderer _stubble = new StubbleBuilder().Build();

    /// <summary>
    /// The most recently generated nonces from rendering, for thread expansion.
    /// </summary>
    public Dictionary<string, string> LastNonces { get; private set; } = [];

    public async Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
    {
        var (renderInputs, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);
        LastNonces = nonces;

        var rendered = await _stubble.RenderAsync(template, renderInputs);
        return rendered;
    }
}
