// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Fluent builder for configuring the Prompty pipeline. Automatically registers
/// core renderers (Jinja2, Mustache) and the Prompty chat parser. Chain provider
/// extension methods (<c>.AddOpenAI()</c>, <c>.AddFoundry()</c>, etc.) to register
/// LLM providers.
/// </summary>
/// <example>
/// <code>
/// new PromptyBuilder()
///     .AddOpenAI()
///     .AddFoundry();
/// </code>
/// </example>
public class PromptyBuilder
{
    /// <summary>
    /// Creates a new <see cref="PromptyBuilder"/> and registers the built-in
    /// renderers (jinja2, mustache) and parser (prompty).
    /// </summary>
    public PromptyBuilder()
    {
        InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        InvokerRegistry.RegisterRenderer("mustache", new MustacheRenderer());
        InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());
    }
}
