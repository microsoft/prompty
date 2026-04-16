// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Calls an LLM provider with messages and returns the raw provider response.
/// </summary>
public interface IExecutor
{
    /// <summary>
    /// Call an LLM provider with messages and return the raw response
    /// </summary>
    Task<object> ExecuteAsync(Prompty agent, List<Message> messages);
    /// <summary>
    /// Format tool call results into messages for the next iteration
    /// </summary>
    List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent);
}
