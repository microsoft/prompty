// Copyright (c) Microsoft. All rights reserved.

using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Prompty.Core;

namespace Prompty.Anthropic;

/// <summary>
/// Executes LLM calls against the Anthropic Messages API.
/// Uses raw HTTP — no official C# SDK dependency.
/// Registered under key "anthropic".
/// </summary>
public class AnthropicExecutor : IExecutor
{
    private static readonly HttpClient _httpClient = new();
    private const string DefaultEndpoint = "https://api.anthropic.com";
    private const string ApiVersion = "2023-06-01";
    private const int DefaultMaxTokens = 4096;

    public async Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
    {
        var streaming = agent.Metadata?.TryGetValue("stream", out var streamVal) == true && streamVal is true;

        if (streaming)
            return ExecuteStreamAsync(agent, messages);

        return await ExecuteNonStreamAsync(agent, messages);
    }

    private async Task<object> ExecuteNonStreamAsync(Core.Prompty agent, List<Message> messages)
    {
        var body = BuildRequestBody(agent, messages, stream: false);
        var (endpoint, apiKey) = GetConnectionInfo(agent);

        var request = CreateRequest(endpoint, apiKey, body);
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json;
    }

    private PromptyStream ExecuteStreamAsync(Core.Prompty agent, List<Message> messages)
    {
        var body = BuildRequestBody(agent, messages, stream: true);
        var (endpoint, apiKey) = GetConnectionInfo(agent);

        async IAsyncEnumerable<object> StreamEvents([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
        {
            var request = CreateRequest(endpoint, apiKey, body);
            var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var reader = new StreamReader(stream);

            while (!reader.EndOfStream)
            {
                var line = await reader.ReadLineAsync(ct);
                if (string.IsNullOrEmpty(line)) continue;
                if (!line.StartsWith("data: ")) continue;
                var data = line["data: ".Length..];
                if (data == "[DONE]") break;

                var evt = JsonSerializer.Deserialize<JsonElement>(data);
                yield return evt;
            }
        }

        return new PromptyStream(StreamEvents());
    }

    internal Dictionary<string, object?> BuildRequestBody(Core.Prompty agent, List<Message> messages, bool stream)
    {
        var model = agent.Model?.Id ?? "claude-sonnet-4-20250514";
        var maxTokens = agent.Model?.Options?.MaxOutputTokens ?? DefaultMaxTokens;

        var systemParts = new List<string>();
        var conversationMessages = new List<Dictionary<string, object?>>();

        foreach (var msg in messages)
        {
            if (msg.Role == Roles.System || msg.Role == Roles.Developer)
            {
                systemParts.Add(msg.Text);
            }
            else
            {
                conversationMessages.Add(MessageToWire(msg));
            }
        }

        var body = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["max_tokens"] = (int)maxTokens,
            ["messages"] = conversationMessages,
        };

        if (systemParts.Count > 0)
            body["system"] = string.Join("\n\n", systemParts);

        if (stream)
            body["stream"] = true;

        // Apply model options via generated wire mapping
        var opts = agent.Model?.Options;
        if (opts is not null)
        {
            var wireOpts = opts.ToWire("anthropic");
            // max_tokens is handled separately above with DefaultMaxTokens fallback
            wireOpts.Remove("max_tokens");
            foreach (var (key, value) in wireOpts)
            {
                body[key] = value;
            }
        }

        var tools = ToolsToWire(agent);
        if (tools is not null) body["tools"] = tools;

        // Structured output → output_config.format.json_schema
        var outputConfig = OutputSchemaToWire(agent);
        if (outputConfig is not null) body["output_config"] = outputConfig;

        return body;
    }

    private static HttpRequestMessage CreateRequest(string endpoint, string apiKey, Dictionary<string, object?> body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"{endpoint}/v1/messages")
        {
            Content = JsonContent.Create(body, options: new JsonSerializerOptions
            {
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            }),
        };
        request.Headers.Add("x-api-key", apiKey);
        request.Headers.Add("anthropic-version", ApiVersion);
        return request;
    }

    private static Dictionary<string, object?> MessageToWire(Message msg)
    {
        var role = msg.Role switch
        {
            Roles.Assistant => "assistant",
            Roles.Tool => "user", // Tool results go as user messages
            _ => "user",
        };

        // Handle tool results
        if (msg.Role == Roles.Tool)
        {
            var toolCallId = msg.Metadata is not null && msg.Metadata.TryGetValue("tool_call_id", out var id)
                ? id?.ToString() ?? ""
                : "";
            return new Dictionary<string, object?>
            {
                ["role"] = "user",
                ["content"] = new List<Dictionary<string, object?>>
                {
                    new()
                    {
                        ["type"] = "tool_result",
                        ["tool_use_id"] = toolCallId,
                        ["content"] = msg.Text,
                    }
                },
            };
        }

        // Build content blocks
        var content = new List<Dictionary<string, object?>>();
        foreach (var part in msg.Parts)
        {
            switch (part)
            {
                case TextPart t:
                    content.Add(new() { ["type"] = "text", ["text"] = t.Value });
                    break;
                case ImagePart i when !string.IsNullOrEmpty(i.MediaType):
                    content.Add(new()
                    {
                        ["type"] = "image",
                        ["source"] = new Dictionary<string, object?>
                        {
                            ["type"] = "base64",
                            ["media_type"] = i.MediaType,
                            ["data"] = i.Source,
                        }
                    });
                    break;
                case ImagePart i:
                    content.Add(new()
                    {
                        ["type"] = "image",
                        ["source"] = new Dictionary<string, object?>
                        {
                            ["type"] = "url",
                            ["url"] = i.Source,
                        }
                    });
                    break;
            }
        }

        // Simplify single text content
        if (content.Count == 1 && content[0]["type"]?.ToString() == "text")
        {
            return new() { ["role"] = role, ["content"] = content[0]["text"] };
        }

        return new() { ["role"] = role, ["content"] = content };
    }

    private static List<Dictionary<string, object?>>? ToolsToWire(Core.Prompty agent)
    {
        if (agent.Tools is null || agent.Tools.Count == 0)
            return null;

        var tools = new List<Dictionary<string, object?>>();
        foreach (var tool in agent.Tools)
        {
            if (tool is Core.FunctionTool ft)
            {
                var inputSchema = SchemaHelpers.PropertiesToJsonSchema(ft.Parameters);
                tools.Add(new()
                {
                    ["name"] = ft.Name ?? "",
                    ["description"] = ft.Description,
                    ["input_schema"] = inputSchema,
                });
            }
        }

        return tools.Count > 0 ? tools : null;
    }

    private static (string endpoint, string apiKey) GetConnectionInfo(Core.Prompty agent)
    {
        var conn = agent.Model?.Connection;

        // §11.1: ReferenceConnection is NOT supported for Anthropic raw HTTP executor.
        // Users should register a pre-configured client via ConnectionRegistry and use
        // the appropriate SDK-based executor instead.
        if (conn is Core.ReferenceConnection refConn)
        {
            throw new InvalidOperationException(
                $"ReferenceConnection '{refConn.Name}' is not supported by the Anthropic raw HTTP executor. " +
                "Use 'key' connection with apiKey for Anthropic.");
        }

        string? apiKey = null;
        string? endpoint = null;

        if (conn is Core.ApiKeyConnection keyConn)
        {
            apiKey = keyConn.ApiKey;
            endpoint = keyConn.Endpoint;
        }
        else
        {
            var kind = conn?.Kind ?? "unknown";
            throw new InvalidOperationException(
                $"Connection kind '{kind}' is not supported by the Anthropic executor. " +
                "Use 'key' (with apiKey) for Anthropic.");
        }

        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException(
                "Anthropic API key is required. Set model.connection.apiKey or ${env:ANTHROPIC_API_KEY}.");

        return (string.IsNullOrEmpty(endpoint) ? DefaultEndpoint : endpoint, apiKey);
    }

    /// <summary>
    /// Convert outputSchema to Anthropic output_config format.
    /// Anthropic format: { format: { type: "json_schema", schema: { ... } } }
    /// </summary>
    internal static Dictionary<string, object?>? OutputSchemaToWire(Core.Prompty agent)
    {
        if (agent.Outputs is null || agent.Outputs.Count == 0)
            return null;

        var schema = SchemaHelpers.PropertiesToJsonSchema(agent.Outputs, strict: true);

        return new Dictionary<string, object?>
        {
            ["format"] = new Dictionary<string, object?>
            {
                ["type"] = "json_schema",
                ["schema"] = schema,
            },
        };
    }

    // -----------------------------------------------------------------------
    // FormatToolMessages — Anthropic wire format
    // -----------------------------------------------------------------------

    /// <summary>
    /// Formats tool messages for the Anthropic Messages API.
    /// Anthropic requires:
    /// 1. Assistant message preserves ALL content blocks (text + tool_use)
    /// 2. Tool results are batched into a single "user" message with tool_result blocks
    /// </summary>
    public Task<List<Message>> FormatToolMessagesAsync(
        object rawResponse,
        List<ToolCall> toolCalls,
        List<string> toolResults,
        string? textContent = null)
    {
        var messages = new List<Message>();

        // --- Assistant message with ALL content blocks (text + tool_use) ---
        var rawContent = new List<Dictionary<string, object?>>();
        if (!string.IsNullOrEmpty(textContent))
        {
            rawContent.Add(new() { ["type"] = "text", ["text"] = textContent });
        }
        foreach (var tc in toolCalls)
        {
            rawContent.Add(new()
            {
                ["type"] = "tool_use",
                ["id"] = tc.Id,
                ["name"] = tc.Name,
                ["input"] = JsonSerializer.Deserialize<JsonElement>(tc.Arguments),
            });
        }

        messages.Add(new Message
        {
            Role = Roles.Assistant,
            Parts = !string.IsNullOrEmpty(textContent)
                ? [new TextPart { Value = textContent }]
                : [],
            Metadata = new Dictionary<string, object?> { ["content"] = rawContent },
        });

        // --- Single user message with batched tool_result blocks ---
        var toolResultBlocks = new List<Dictionary<string, object?>>();
        for (var i = 0; i < toolCalls.Count; i++)
        {
            toolResultBlocks.Add(new()
            {
                ["type"] = "tool_result",
                ["tool_use_id"] = toolCalls[i].Id,
                ["content"] = toolResults[i],
            });
        }

        messages.Add(new Message
        {
            Role = Roles.User,
            Parts = toolResults.Select(r => (ContentPart)new TextPart { Value = r }).ToList(),
            Metadata = new Dictionary<string, object?> { ["tool_results"] = toolResultBlocks },
        });

        return Task.FromResult(messages);
    }
}
