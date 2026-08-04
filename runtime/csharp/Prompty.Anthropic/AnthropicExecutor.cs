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
            if (msg.Role == Role.System || msg.Role == Role.Developer)
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
            Role.Assistant => "assistant",
            Role.Tool => "user", // Tool results go as user messages
            _ => "user",
        };

        if (msg.Metadata is not null
            && msg.Metadata.TryGetValue("tool_results", out var toolResults))
        {
            return new Dictionary<string, object?>
            {
                ["role"] = role,
                ["content"] = toolResults,
            };
        }

        if (msg.Metadata is not null
            && msg.Metadata.TryGetValue("tool_use_id", out var toolUseId))
        {
            return BuildToolResultMessage(toolUseId?.ToString() ?? "", msg.Text);
        }

        if (msg.Metadata is not null
            && msg.Metadata.TryGetValue("content", out var rawContent))
        {
            return new Dictionary<string, object?>
            {
                ["role"] = role,
                ["content"] = rawContent,
            };
        }

        if (msg.Role == Role.Tool)
        {
            var toolCallId = msg.Metadata is not null && msg.Metadata.TryGetValue("tool_call_id", out var id)
                ? id?.ToString() ?? ""
                : "";
            return BuildToolResultMessage(toolCallId, msg.Text);
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

        return new() { ["role"] = role, ["content"] = content };
    }

    private static Dictionary<string, object?> BuildToolResultMessage(string toolUseId, string content)
    {
        return new Dictionary<string, object?>
        {
            ["role"] = "user",
            ["content"] = new List<Dictionary<string, object?>>
            {
                new()
                {
                    ["type"] = "tool_result",
                    ["tool_use_id"] = toolUseId,
                    ["content"] = content,
                }
            },
        };
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
                var parameterSchema = SchemaHelpers.PropertiesToJsonSchema(ft.Parameters);
                tools.Add(new()
                {
                    ["name"] = ft.Name ?? "",
                    ["description"] = ft.Description,
                    ["input_schema"] = parameterSchema,
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
    /// Convert outputs to Anthropic output_config format.
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
    public List<Message> FormatToolMessages(
        object rawResponse,
        List<ToolCall> toolCalls,
        List<string> toolResults,
        string? textContent = null)
    {
        var messages = new List<Message>();

        messages.Add(new Message
        {
            Role = Role.Assistant,
            Parts = !string.IsNullOrEmpty(textContent)
                ? [new TextPart { Value = textContent }]
                : [],
            Metadata = new Dictionary<string, object> { ["content"] = GetRawContent(rawResponse) },
        });

        // --- Single user message with batched tool_result blocks ---
        var toolResultBlocks = new List<Dictionary<string, object?>>();
        for (var i = 0; i < Math.Min(toolCalls.Count, toolResults.Count); i++)
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
            Role = Role.User,
            Parts = toolResults.Select(r => (ContentPart)new TextPart { Value = r }).ToList(),
            Metadata = new Dictionary<string, object> { ["tool_results"] = toolResultBlocks },
        });

        return messages;
    }

    private static object GetRawContent(object rawResponse)
    {
        if (rawResponse is PromptyStream stream)
        {
            return ReconstructStreamContent(stream.Items);
        }

        if (rawResponse is JsonElement { ValueKind: JsonValueKind.Object } element
            && element.TryGetProperty("content", out var content))
        {
            return content.Clone();
        }

        if (rawResponse is IReadOnlyDictionary<string, object?> dictionary
            && dictionary.TryGetValue("content", out var value)
            && value is not null)
        {
            return value;
        }

        return Array.Empty<object>();
    }

    private static List<Dictionary<string, object?>> ReconstructStreamContent(IReadOnlyList<object> items)
    {
        var blocks = new SortedDictionary<int, Dictionary<string, object?>>();
        var textDeltas = new Dictionary<int, List<string>>();
        var thinkingDeltas = new Dictionary<int, List<string>>();
        var signatureDeltas = new Dictionary<int, List<string>>();
        var inputDeltas = new Dictionary<int, List<string>>();

        foreach (var item in items)
        {
            if (item is not JsonElement evt
                || !evt.TryGetProperty("type", out var eventType))
            {
                continue;
            }

            if (eventType.GetString() == "content_block_start"
                && evt.TryGetProperty("index", out var startIndex)
                && evt.TryGetProperty("content_block", out var contentBlock))
            {
                blocks[startIndex.GetInt32()] =
                    JsonSerializer.Deserialize<Dictionary<string, object?>>(contentBlock.GetRawText()) ?? [];
                continue;
            }

            if (eventType.GetString() != "content_block_delta"
                || !evt.TryGetProperty("index", out var deltaIndex)
                || !evt.TryGetProperty("delta", out var delta)
                || !delta.TryGetProperty("type", out var deltaType))
            {
                continue;
            }

            var index = deltaIndex.GetInt32();
            switch (deltaType.GetString())
            {
                case "text_delta":
                    AppendDelta(textDeltas, index, delta, "text");
                    break;
                case "thinking_delta":
                    AppendDelta(thinkingDeltas, index, delta, "thinking");
                    break;
                case "signature_delta":
                    AppendDelta(signatureDeltas, index, delta, "signature");
                    break;
                case "input_json_delta":
                    AppendDelta(inputDeltas, index, delta, "partial_json");
                    break;
            }
        }

        foreach (var (index, block) in blocks)
        {
            if (textDeltas.TryGetValue(index, out var text))
            {
                block["text"] = string.Concat(text);
            }
            if (thinkingDeltas.TryGetValue(index, out var thinking))
            {
                block["thinking"] = string.Concat(thinking);
            }
            if (signatureDeltas.TryGetValue(index, out var signature))
            {
                block["signature"] = string.Concat(signature);
            }
            if (inputDeltas.TryGetValue(index, out var input))
            {
                var json = string.Concat(input);
                try
                {
                    block["input"] = JsonSerializer.Deserialize<object>(json) ?? new Dictionary<string, object?>();
                }
                catch (JsonException)
                {
                    // Keep the valid initial input block when the provider stops mid-JSON.
                }
            }
        }

        return blocks.Values.ToList();
    }

    private static void AppendDelta(
        Dictionary<int, List<string>> target,
        int index,
        JsonElement delta,
        string property)
    {
        if (!delta.TryGetProperty(property, out var value)
            || string.IsNullOrEmpty(value.GetString()))
        {
            return;
        }
        if (!target.TryGetValue(index, out var values))
        {
            values = [];
            target[index] = values;
        }
        values.Add(value.GetString()!);
    }
}
