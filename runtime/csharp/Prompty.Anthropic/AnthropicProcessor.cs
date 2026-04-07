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
                return JsonSerializer.Deserialize<JsonElement>(text);
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
}
