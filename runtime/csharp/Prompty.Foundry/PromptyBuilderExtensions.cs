// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Foundry;

/// <summary>
/// Extension methods for registering the Foundry (Azure OpenAI) provider
/// with <see cref="PromptyBuilder"/>.
/// </summary>
public static class PromptyBuilderExtensions
{
    /// <summary>
    /// Registers the Foundry executor and processor for both
    /// <c>provider: foundry</c> and the legacy <c>provider: azure</c> alias.
    /// </summary>
    public static PromptyBuilder AddFoundry(this PromptyBuilder builder)
    {
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        InvokerRegistry.RegisterExecutor("foundry", executor);
        InvokerRegistry.RegisterProcessor("foundry", processor);

        // Legacy "azure" alias for backward compatibility
        InvokerRegistry.RegisterExecutor("azure", executor);
        InvokerRegistry.RegisterProcessor("azure", processor);

        return builder;
    }
}
