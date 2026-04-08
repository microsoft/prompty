// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Step-by-step pipeline: Load → Prepare → Run, showing each stage.
/// </summary>
public static class ChatPipeline
{
    /// <summary>
    /// Demonstrates each pipeline stage individually.
    /// Returns the final processed result.
    /// </summary>
    public static async Task<object> RunAsync(string promptyPath, Dictionary<string, object?>? inputs = null)
    {
        // One-time setup
        new PromptyBuilder()
            .AddOpenAI();

        // Step 1: Load the .prompty file into a typed Prompty instance
        var agent = PromptyLoader.Load(promptyPath);

        // Step 2: Prepare — validate inputs, render template, parse into messages
        var messages = await Pipeline.PrepareAsync(agent, inputs);

        // Step 3: Run — execute LLM call and post-process the response
        var result = await Pipeline.RunAsync(agent, messages);

        return result;
    }

    /// <summary>
    /// Demonstrates rendering and parsing separately for maximum control.
    /// </summary>
    public static async Task<List<Message>> PrepareOnlyAsync(string promptyPath, Dictionary<string, object?>? inputs = null)
    {
        var agent = PromptyLoader.Load(promptyPath);

        // Validate and fill defaults
        var validatedInputs = Pipeline.ValidateInputs(agent, inputs);

        // Render the template with inputs
        var rendered = await Pipeline.RenderAsync(agent, validatedInputs);

        // Parse rendered text into messages
        var messages = await Pipeline.ParseAsync(agent, rendered);

        return messages;
    }
}
