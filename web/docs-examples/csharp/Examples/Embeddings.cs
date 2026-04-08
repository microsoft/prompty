// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Generate text embeddings using an embedding .prompty file.
/// </summary>
public static class Embeddings
{
    /// <summary>
    /// Load an embedding .prompty and invoke to get vector embeddings.
    /// The prompty file sets apiType: embedding.
    /// </summary>
    public static async Task<object> RunAsync(
        string promptyPath,
        Dictionary<string, object?>? inputs = null)
    {
        // Register providers
        InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());

        // Full pipeline — executor dispatches on apiType: embedding
        var result = await Pipeline.InvokeAsync(promptyPath, inputs);
        return result;
    }
}
