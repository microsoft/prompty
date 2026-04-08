// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Anthropic;

/// <summary>
/// Processes raw Anthropic API responses (JsonElement) into final results.
/// Registered under key "anthropic".
/// </summary>
public class AnthropicProcessor : IProcessor
{
    public Task<object> ProcessAsync(Core.Prompty agent, object response)
    {
        if (response is PromptyStream stream)
        {
            // If stream was already consumed (agent loop pre-drains it),
            // reconstruct the result from accumulated SSE events
            if (stream.Items.Count > 0)
                return Task.FromResult(ReconstructFromStreamItems(stream.Items, agent));

            return Task.FromResult<object>(new AnthropicProcessedStream(stream));
        }

        if (response is not JsonElement json)
            return Task.FromResult(response);

        var result = ProcessResponse(json, agent);
        return Task.FromResult(result);
    }

    private static object ProcessResponse(JsonElement json, Core.Prompty agent)
    {
        // Check stop_reason for tool_use
        var stopReason = json.TryGetProperty("stop_reason", out var sr) ? sr.GetString() : null;

        if (stopReason == "tool_use")
        {
            return ExtractToolCalls(json);
        }

        // Extract text content from content blocks
        var text = ExtractText(json);

        // If structured output, try JSON parse
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

    private static string ExtractText(JsonElement json)
    {
        if (!json.TryGetProperty("content", out var content))
            return "";

        var textParts = new List<string>();
        foreach (var block in content.EnumerateArray())
        {
            if (block.TryGetProperty("type", out var type) && type.GetString() == "text")
            {
                if (block.TryGetProperty("text", out var text))
                    textParts.Add(text.GetString() ?? "");
            }
        }

        return string.Join("", textParts);
    }

    private static ToolCallResult ExtractToolCalls(JsonElement json)
    {
        var toolCalls = new List<ToolCall>();
        string? textContent = null;

        if (json.TryGetProperty("content", out var content))
        {
            foreach (var block in content.EnumerateArray())
            {
                var type = block.TryGetProperty("type", out var t) ? t.GetString() : null;

                if (type == "tool_use")
                {
                    toolCalls.Add(new ToolCall
                    {
                        Id = block.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                        Name = block.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "",
                        Arguments = block.TryGetProperty("input", out var input)
                            ? input.GetRawText()
                            : "",
                    });
                }
                else if (type == "text")
                {
                    textContent = block.TryGetProperty("text", out var text) ? text.GetString() : null;
                }
            }
        }

        return new ToolCallResult
        {
            Content = textContent,
            ToolCalls = toolCalls,
        };
    }

    /// <summary>
    /// Reconstructs a final result from accumulated SSE events (after the stream has been consumed).
    /// Handles tool calls (content_block_start/delta with tool_use) and text deltas.
    /// </summary>
    private static object ReconstructFromStreamItems(IReadOnlyList<object> items, Core.Prompty agent)
    {
        var textParts = new List<string>();
        var toolCalls = new Dictionary<int, ToolCall>();
        var toolInputJsonParts = new Dictionary<int, List<string>>();
        string? stopReason = null;

        foreach (var item in items)
        {
            if (item is not JsonElement evt) continue;

            var eventType = evt.TryGetProperty("type", out var t) ? t.GetString() : null;

            switch (eventType)
            {
                case "content_block_start":
                    if (evt.TryGetProperty("index", out var idxProp) &&
                        evt.TryGetProperty("content_block", out var block))
                    {
                        var idx = idxProp.GetInt32();
                        var blockType = block.TryGetProperty("type", out var bt) ? bt.GetString() : null;
                        if (blockType == "tool_use")
                        {
                            toolCalls[idx] = new ToolCall
                            {
                                Id = block.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                                Name = block.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "",
                                Arguments = "",
                            };
                            toolInputJsonParts[idx] = [];
                        }
                    }
                    break;

                case "content_block_delta":
                    if (evt.TryGetProperty("index", out var deltaIdx) &&
                        evt.TryGetProperty("delta", out var delta))
                    {
                        var idx2 = deltaIdx.GetInt32();
                        var deltaType = delta.TryGetProperty("type", out var dt) ? dt.GetString() : null;

                        if (deltaType == "text_delta")
                        {
                            if (delta.TryGetProperty("text", out var text))
                            {
                                var txt = text.GetString();
                                if (!string.IsNullOrEmpty(txt))
                                    textParts.Add(txt);
                            }
                        }
                        else if (deltaType == "input_json_delta")
                        {
                            if (delta.TryGetProperty("partial_json", out var pj))
                            {
                                var partial = pj.GetString();
                                if (!string.IsNullOrEmpty(partial))
                                {
                                    if (!toolInputJsonParts.ContainsKey(idx2))
                                        toolInputJsonParts[idx2] = [];
                                    toolInputJsonParts[idx2].Add(partial);
                                }
                            }
                        }
                    }
                    break;

                case "message_delta":
                    if (evt.TryGetProperty("delta", out var msgDelta) &&
                        msgDelta.TryGetProperty("stop_reason", out var sr))
                    {
                        stopReason = sr.GetString();
                    }
                    break;
            }
        }

        // Assemble tool call arguments from partial JSON chunks
        foreach (var (idx, parts) in toolInputJsonParts)
        {
            if (toolCalls.TryGetValue(idx, out var tc))
            {
                tc.Arguments = string.Join("", parts);
            }
        }

        // If we have tool calls, return ToolCallResult
        if (toolCalls.Count > 0 || stopReason == "tool_use")
        {
            return new ToolCallResult
            {
                Content = textParts.Count > 0 ? string.Join("", textParts) : null,
                ToolCalls = toolCalls.Values.ToList(),
            };
        }

        // Otherwise return accumulated text
        var fullText = string.Join("", textParts);

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
}

/// <summary>
/// Wraps a PromptyStream to extract delta text from Anthropic SSE events.
/// </summary>
public class AnthropicProcessedStream : IAsyncEnumerable<string>
{
    private readonly PromptyStream _inner;

    public AnthropicProcessedStream(PromptyStream inner) => _inner = inner;

    public async IAsyncEnumerator<string> GetAsyncEnumerator(
        CancellationToken cancellationToken = default)
    {
        await foreach (var chunk in _inner.WithCancellation(cancellationToken))
        {
            if (chunk is JsonElement evt)
            {
                var type = evt.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type == "content_block_delta")
                {
                    if (evt.TryGetProperty("delta", out var delta) &&
                        delta.TryGetProperty("text", out var text))
                    {
                        var txt = text.GetString();
                        if (!string.IsNullOrEmpty(txt))
                            yield return txt;
                    }
                }
            }
        }
    }
}
