// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.ClientModel;
using System.Runtime.CompilerServices;
using OpenAI;
using OpenAI.Chat;
using OpenAI.Embeddings;
using OpenAI.Images;
using OpenAI.Responses;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Executes LLM calls against the OpenAI API.
/// Dispatches on apiType: chat (default), responses, embedding, image.
/// Registered under key "openai".
/// </summary>
public class OpenAIExecutor : IExecutor
{
    public async Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
    {
        var apiType = agent.Model?.ApiType ?? "chat";
        var model = agent.Model?.Id ?? "gpt-4";
        var client = CreateClient(agent);
        var streaming = agent.Metadata?.TryGetValue("stream", out var streamVal) == true && streamVal is true;

        return apiType switch
        {
            "chat" when streaming => ExecuteChatStreamAsync(client, model, agent, messages),
            "chat" => await ExecuteChatAsync(client, model, agent, messages),
            "responses" when streaming => ExecuteResponsesStreamAsync(client, model, agent, messages),
            "responses" => await ExecuteResponsesAsync(client, model, agent, messages),
            "embedding" => await ExecuteEmbeddingAsync(client, model, messages),
            "image" => await ExecuteImageAsync(client, model, messages),
            _ => throw new InvalidOperationException($"Unsupported API type: {apiType}"),
        };
    }

    protected virtual OpenAIClient CreateClient(Core.Prompty agent)
    {
        var conn = agent.Model?.Connection;
        string? apiKey = null;

        if (conn is Core.ApiKeyConnection keyConn)
        {
            apiKey = keyConn.ApiKey;
        }

        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException(
                "OpenAI API key is required. Set model.connection.apiKey or ${env:OPENAI_API_KEY}.");

        return new OpenAIClient(apiKey);
    }

    private static async Task<object> ExecuteChatAsync(
        OpenAIClient client, string model, Core.Prompty agent, List<Message> messages)
    {
        var chatClient = client.GetChatClient(model);
        var chatMessages = messages.Select(WireFormat.MessageToWire).ToList();
        var options = WireFormat.BuildOptions(agent);

        var result = await chatClient.CompleteChatAsync(chatMessages, options);
        return result.Value;
    }

    private static PromptyStream ExecuteChatStreamAsync(
        OpenAIClient client, string model, Core.Prompty agent, List<Message> messages)
    {
        var chatClient = client.GetChatClient(model);
        var chatMessages = messages.Select(WireFormat.MessageToWire).ToList();
        var options = WireFormat.BuildOptions(agent);

        async IAsyncEnumerable<object> StreamChunks([EnumeratorCancellation] CancellationToken ct = default)
        {
            var stream = chatClient.CompleteChatStreamingAsync(chatMessages, options, ct);
            await foreach (var update in stream)
            {
                yield return update;
            }
        }

        return new PromptyStream(StreamChunks());
    }

    // -----------------------------------------------------------------------
    // Responses API
    // -----------------------------------------------------------------------

    private static async Task<object> ExecuteResponsesAsync(
        OpenAIClient client, string model, Core.Prompty agent, List<Message> messages)
    {
        var responsesClient = client.GetResponsesClient();
        var options = WireFormat.BuildResponsesOptions(model, agent, messages);
        var result = await responsesClient.CreateResponseAsync(options);
        return result.Value;
    }

    private static PromptyStream ExecuteResponsesStreamAsync(
        OpenAIClient client, string model, Core.Prompty agent, List<Message> messages)
    {
        var responsesClient = client.GetResponsesClient();
        var options = WireFormat.BuildResponsesOptions(model, agent, messages);

        async IAsyncEnumerable<object> StreamChunks([EnumeratorCancellation] CancellationToken ct = default)
        {
            var stream = responsesClient.CreateResponseStreamingAsync(options, ct);
            await foreach (var update in stream)
            {
                yield return update;
            }
        }

        return new PromptyStream(StreamChunks());
    }

    // -----------------------------------------------------------------------
    // Embedding / Image
    // -----------------------------------------------------------------------

    private static async Task<object> ExecuteEmbeddingAsync(
        OpenAIClient client, string model, List<Message> messages)
    {
        var embeddingClient = client.GetEmbeddingClient(model);
        var inputs = messages.Select(m => m.Text).ToList();
        var result = await embeddingClient.GenerateEmbeddingsAsync(inputs);
        return result.Value;
    }

    private static async Task<object> ExecuteImageAsync(
        OpenAIClient client, string model, List<Message> messages)
    {
        var imageClient = client.GetImageClient(model);
        var prompt = messages.LastOrDefault()?.Text ?? "";
        var result = await imageClient.GenerateImageAsync(prompt);
        return result.Value;
    }

    // -----------------------------------------------------------------------
    // FormatToolMessages — OpenAI / Chat + Responses wire format
    // -----------------------------------------------------------------------

    /// <inheritdoc />
    public virtual List<Message> FormatToolMessages(
        object rawResponse,
        List<ToolCall> toolCalls,
        List<string> toolResults,
        string? textContent = null)
    {
        var messages = new List<Message>();

        // --- Assistant message with tool_calls metadata ---
        var assistantParts = string.IsNullOrEmpty(textContent)
            ? new List<ContentPart>()
            : new List<ContentPart> { new TextPart { Value = textContent } };

        var rawToolCalls = toolCalls.Select(tc => new Dictionary<string, object?>
        {
            ["id"] = tc.Id,
            ["type"] = "function",
            ["function"] = new Dictionary<string, object?>
            {
                ["name"] = tc.Name,
                ["arguments"] = tc.Arguments,
            },
        }).ToList();

        messages.Add(new Message
        {
            Role = Roles.Assistant,
            Parts = assistantParts,
            Metadata = new Dictionary<string, object?> { ["tool_calls"] = rawToolCalls },
        });

        // --- One tool message per result ---
        for (var i = 0; i < toolCalls.Count; i++)
        {
            messages.Add(new Message
            {
                Role = Roles.Tool,
                Parts = [new TextPart { Value = toolResults[i] }],
                Metadata = new Dictionary<string, object?>
                {
                    ["tool_call_id"] = toolCalls[i].Id,
                    ["name"] = toolCalls[i].Name,
                },
            });
        }

        return messages;
    }
}
