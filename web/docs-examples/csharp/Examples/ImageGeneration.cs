// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Image generation — the prompty sets apiType: image to dispatch to DALL-E.
/// </summary>
public static class ImageGeneration
{
    /// <summary>
    /// Load an image generation .prompty and invoke it.
    /// The executor dispatches on apiType: image to call the images API.
    /// </summary>
    public static async Task<object> RunAsync(
        string promptyPath,
        Dictionary<string, object?>? inputs = null)
    {
        // One-time setup
        new PromptyBuilder()
            .AddOpenAI();

        var result = await Pipeline.InvokeAsync(promptyPath, inputs);
        return result;
    }
}
