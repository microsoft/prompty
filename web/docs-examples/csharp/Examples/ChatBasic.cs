// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Basic chat completion — load a .prompty file and invoke it.
/// </summary>
public static class ChatBasic
{
    /// <summary>
    /// Load a .prompty file and run the full pipeline (render → parse → execute → process).
    /// </summary>
    public static async Task<object> RunAsync(string promptyPath, Dictionary<string, object?>? inputs = null)
    {
        // One-time setup — registers renderers, parser, and OpenAI provider
        new PromptyBuilder()
            .AddOpenAI();

        // Full pipeline: load → prepare → run
        var result = await Pipeline.InvokeAsync(promptyPath, inputs);
        return result;
    }
}
