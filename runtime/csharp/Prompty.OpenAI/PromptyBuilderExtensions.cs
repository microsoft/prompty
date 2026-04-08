// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Extension methods for registering the OpenAI provider with <see cref="PromptyBuilder"/>.
/// </summary>
public static class PromptyBuilderExtensions
{
    /// <summary>
    /// Registers the OpenAI executor and processor for <c>provider: openai</c>.
    /// </summary>
    public static PromptyBuilder AddOpenAI(this PromptyBuilder builder)
    {
        InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());
        return builder;
    }
}
