// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Structured output — the prompty's outputs schema is converted to
/// an OpenAI response_format, ensuring the LLM returns valid JSON.
/// </summary>
public static class StructuredOutput
{
    /// <summary>
    /// Load a .prompty with an outputs schema and invoke it.
    /// The executor converts the outputs schema to response_format automatically.
    /// </summary>
    public static async Task<object> RunAsync(
        string promptyPath,
        Dictionary<string, object?>? inputs = null)
    {
        // Register providers
        InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());

        var result = await Pipeline.InvokeAsync(promptyPath, inputs);
        return result;
    }
}
