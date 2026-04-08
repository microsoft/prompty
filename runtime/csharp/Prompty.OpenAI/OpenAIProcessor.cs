// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.Text.Json;
using OpenAI.Chat;
using OpenAI.Embeddings;
using OpenAI.Images;
using OpenAI.Responses;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Processes raw OpenAI SDK responses into final results.
/// Registered under key "openai".
/// </summary>
public class OpenAIProcessor : IProcessor
{
    public Task<object> ProcessAsync(Core.Prompty agent, object response)
    {
        var result = response switch
        {
            ChatCompletion chat => ProcessChat(chat, agent),
            ResponseResult responses => ProcessResponses(responses, agent),
            OpenAIEmbeddingCollection embeddings => ProcessEmbeddings(embeddings),
            GeneratedImage image => ProcessImage(image),
            PromptyStream stream => ProcessStream(stream, agent),
            _ => response,
        };

        return Task.FromResult(result);
    }

    private static object ProcessChat(ChatCompletion completion, Core.Prompty agent)
    {
        // Check for tool calls
        if (completion.ToolCalls is not null && completion.ToolCalls.Count > 0)
        {
            var toolCalls = completion.ToolCalls.Select(tc => new ToolCall
            {
                Id = tc.Id,
                Name = tc.FunctionName,
                Arguments = tc.FunctionArguments?.ToString() ?? "",
            }).ToList();

            return new ToolCallResult
            {
                Content = completion.Content?.FirstOrDefault()?.Text,
                ToolCalls = toolCalls,
            };
        }

        // Check for refusal
        if (!string.IsNullOrEmpty(completion.Refusal))
            return completion.Refusal;

        // Extract text content
        var text = completion.Content?.FirstOrDefault()?.Text ?? "";

        // If structured output (outputSchema defined), try to parse as JSON
        if (agent.Outputs is not null && agent.Outputs.Count > 0 && !string.IsNullOrEmpty(text))
        {
            try
            {
                return StructuredResult.FromJson(text);
            }
            catch (JsonException)
            {
                return text; // Fallback to raw string
            }
        }

        return text;
    }

    // -----------------------------------------------------------------------
    // Responses API processing
    // -----------------------------------------------------------------------

    private static object ProcessResponses(ResponseResult result, Core.Prompty agent)
    {
        // Check for API error
        if (result.Error is not null)
            throw new InvalidOperationException(
                $"Responses API error ({result.Error.Code}): {result.Error.Message}");

        // Check for function call items → tool calls
        var functionCalls = result.OutputItems
            .OfType<FunctionCallResponseItem>()
            .ToList();

        if (functionCalls.Count > 0)
        {
            var toolCalls = functionCalls.Select(fc => new ToolCall
            {
                Id = fc.CallId ?? fc.Id ?? "",
                Name = fc.FunctionName ?? "",
                Arguments = fc.FunctionArguments?.ToString() ?? "",
            }).ToList();

            return new ToolCallResult
            {
                ToolCalls = toolCalls,
            };
        }

        // Extract text from message output items
        var textParts = new List<string>();
        foreach (var item in result.OutputItems)
        {
            if (item is MessageResponseItem messageItem)
            {
                foreach (var part in messageItem.Content)
                {
                    if (part.Kind == ResponseContentPartKind.OutputText && !string.IsNullOrEmpty(part.Text))
                        textParts.Add(part.Text);
                }
            }
        }

        var text = string.Join("", textParts);

        // If structured output (outputSchema defined), try to parse as JSON
        if (agent.Outputs is not null && agent.Outputs.Count > 0 && !string.IsNullOrEmpty(text))
        {
            try
            {
                return StructuredResult.FromJson(text);
            }
            catch (JsonException)
            {
                return text;
            }
        }

        return text;
    }

    /// <summary>
    /// Wraps a PromptyStream with delta extraction per spec §10.2.
    /// If the stream has already been consumed (e.g., by agent loop),
    /// reconstructs the result from accumulated items.
    /// </summary>
    private static object ProcessStream(PromptyStream stream, Core.Prompty agent)
    {
        // If stream was already consumed (agent loop pre-drains it),
        // reconstruct the result from accumulated items
        if (stream.Items.Count > 0)
        {
            return ReconstructFromStreamItems(stream.Items, agent);
        }

        return new ProcessedStream(stream);
    }

    /// <summary>
    /// Reconstructs a final result from accumulated streaming chunks.
    /// Handles tool calls, text content, and structured output.
    /// </summary>
    private static object ReconstructFromStreamItems(IReadOnlyList<object> items, Core.Prompty agent)
    {
        // Accumulate tool calls and text from streaming updates
        var toolCallMap = new Dictionary<int, ToolCall>();
        var textParts = new List<string>();

        foreach (var item in items)
        {
            // Chat Completions streaming
            if (item is StreamingChatCompletionUpdate update)
            {
                foreach (var part in update.ContentUpdate)
                {
                    if (!string.IsNullOrEmpty(part.Text))
                        textParts.Add(part.Text);
                }

                foreach (var tc in update.ToolCallUpdates)
                {
                    if (!toolCallMap.TryGetValue(tc.Index, out var existing))
                    {
                        existing = new ToolCall
                        {
                            Id = tc.ToolCallId ?? "",
                            Name = tc.FunctionName ?? "",
                            Arguments = "",
                        };
                        toolCallMap[tc.Index] = existing;
                    }

                    if (!string.IsNullOrEmpty(tc.ToolCallId))
                        existing.Id = tc.ToolCallId;
                    if (!string.IsNullOrEmpty(tc.FunctionName))
                        existing.Name = tc.FunctionName;
                    if (tc.FunctionArgumentsUpdate is not null)
                        existing.Arguments += tc.FunctionArgumentsUpdate.ToString();
                }
            }
            // Responses API streaming — text deltas
            else if (item is StreamingResponseOutputTextDeltaUpdate textDelta)
            {
                if (!string.IsNullOrEmpty(textDelta.Delta))
                    textParts.Add(textDelta.Delta);
            }
            // Responses API streaming — function call argument deltas
            else if (item is StreamingResponseFunctionCallArgumentsDeltaUpdate argDelta)
            {
                var key = argDelta.OutputIndex;
                if (!toolCallMap.TryGetValue(key, out var existing))
                {
                    existing = new ToolCall
                    {
                        Id = argDelta.ItemId ?? "",
                        Name = "",
                        Arguments = "",
                    };
                    toolCallMap[key] = existing;
                }
                if (argDelta.Delta is not null)
                    existing.Arguments += argDelta.Delta.ToString();
            }
            // Responses API streaming — output item added (captures function name)
            else if (item is StreamingResponseOutputItemAddedUpdate itemAdded)
            {
                if (itemAdded.Item is FunctionCallResponseItem fcItem)
                {
                    toolCallMap[itemAdded.OutputIndex] = new ToolCall
                    {
                        Id = fcItem.CallId ?? fcItem.Id ?? "",
                        Name = fcItem.FunctionName ?? "",
                        Arguments = fcItem.FunctionArguments?.ToString() ?? "",
                    };
                }
            }
            // Responses API streaming — completed (has the full response)
            else if (item is StreamingResponseCompletedUpdate completed)
            {
                // If we get a completed update, process it like a normal ResponseResult
                return ProcessResponses(completed.Response, agent);
            }
        }

        // If we have tool calls, return a ToolCallResult
        if (toolCallMap.Count > 0)
        {
            var text = string.Join("", textParts);
            return new ToolCallResult
            {
                Content = string.IsNullOrEmpty(text) ? null : text,
                ToolCalls = toolCallMap.OrderBy(kv => kv.Key).Select(kv => kv.Value).ToList(),
            };
        }

        // Otherwise return text content
        var fullText = string.Join("", textParts);

        // Structured output parsing
        if (agent.Outputs is not null && agent.Outputs.Count > 0 && !string.IsNullOrEmpty(fullText))
        {
            try
            {
                return StructuredResult.FromJson(fullText);
            }
            catch (JsonException)
            {
                return fullText;
            }
        }

        return fullText;
    }

    private static object ProcessEmbeddings(OpenAIEmbeddingCollection embeddings)
    {
        if (embeddings.Count == 1)
            return embeddings[0].ToFloats().ToArray();

        return embeddings.Select(e => e.ToFloats().ToArray()).ToList();
    }

    private static object ProcessImage(GeneratedImage image)
    {
        if (image.ImageUri is not null)
            return image.ImageUri.ToString();

        if (image.ImageBytes is not null)
            return Convert.ToBase64String(image.ImageBytes.ToArray());

        return "";
    }
}

/// <summary>
/// Wraps a PromptyStream to extract delta content from streaming chunks.
/// </summary>
public class ProcessedStream : IAsyncEnumerable<string>
{
    private readonly PromptyStream _inner;

    public ProcessedStream(PromptyStream inner) => _inner = inner;

    public async IAsyncEnumerator<string> GetAsyncEnumerator(
        CancellationToken cancellationToken = default)
    {
        await foreach (var chunk in _inner.WithCancellation(cancellationToken))
        {
            // Chat Completions streaming
            if (chunk is StreamingChatCompletionUpdate update)
            {
                foreach (var part in update.ContentUpdate)
                {
                    if (!string.IsNullOrEmpty(part.Text))
                        yield return part.Text;
                }
            }
            // Responses API streaming — text deltas
            else if (chunk is StreamingResponseOutputTextDeltaUpdate textDelta)
            {
                if (!string.IsNullOrEmpty(textDelta.Delta))
                    yield return textDelta.Delta;
            }
        }
    }
}
