// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Extracts a clean, typed result from a raw LLM provider response.
/// </summary>
public interface IProcessor
{
    /// <summary>
    /// Extract a clean result from a raw LLM response
    /// </summary>
    Task<object> ProcessAsync(Prompty agent, object response);
    /// <summary>
    /// Process a streaming response into a stream of StreamChunk items. Takes raw chunks from the executor and yields processed text, thinking, tool, or error chunks. Not all providers support streaming; the default implementation should signal lack of support.
    /// </summary>
    Task<object> ProcessStreamAsync(object stream) => Task.FromResult<object>(default);
}
