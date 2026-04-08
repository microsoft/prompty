// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Streaming chat completion — consume response chunks as they arrive.
/// </summary>
public static class Streaming
{
    /// <summary>
    /// Invokes a streaming .prompty and iterates over the PromptyStream chunks.
    /// The streaming-chat.prompty sets stream:true via additionalProperties.
    /// </summary>
    public static async Task<List<object>> RunAsync(
        string promptyPath,
        Dictionary<string, object?>? inputs = null)
    {
        // Register providers
        InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());

        // Load the agent — stream: true is set in the prompty's additionalProperties
        var agent = PromptyLoader.Load(promptyPath);

        // Set streaming flag in metadata (the executor checks this)
        agent.Metadata ??= new Dictionary<string, object>();
        agent.Metadata["stream"] = true;

        // Prepare messages
        var messages = await Pipeline.PrepareAsync(agent, inputs);

        // Execute returns a PromptyStream when streaming is enabled
        var response = await Pipeline.ExecuteAsync(agent, messages);

        var chunks = new List<object>();
        if (response is PromptyStream stream)
        {
            await foreach (var chunk in stream)
            {
                chunks.Add(chunk);
            }
        }

        return chunks;
    }
}
