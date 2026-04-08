// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Anthropic;

/// <summary>
/// Extension methods for registering the Anthropic provider with <see cref="PromptyBuilder"/>.
/// </summary>
public static class PromptyBuilderExtensions
{
    /// <summary>
    /// Registers the Anthropic executor and processor for <c>provider: anthropic</c>.
    /// </summary>
    public static PromptyBuilder AddAnthropic(this PromptyBuilder builder)
    {
        InvokerRegistry.RegisterExecutor("anthropic", new AnthropicExecutor());
        InvokerRegistry.RegisterProcessor("anthropic", new AnthropicProcessor());
        return builder;
    }
}
