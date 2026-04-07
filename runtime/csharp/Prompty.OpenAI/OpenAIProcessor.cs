// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using OpenAI.Chat;
using OpenAI.Embeddings;
using OpenAI.Images;
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
            OpenAIEmbeddingCollection embeddings => ProcessEmbeddings(embeddings),
            GeneratedImage image => ProcessImage(image),
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
                return JsonSerializer.Deserialize<JsonElement>(text);
            }
            catch (JsonException)
            {
                return text; // Fallback to raw string
            }
        }

        return text;
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
